import { JSDOM } from "jsdom";
import { z } from "zod";
import { calculateContrast } from "../contrast.js";

const MAX_PATCH_BYTES = 4_000;
const MAX_CONTEXT_BYTES = 6_000;
const MAX_PROVIDED_CSS_BYTES = 100_000;
const forbiddenTags = new Set(["script", "iframe", "frame", "object", "embed", "base", "meta", "link", "form"]);
const proposalSchema = z.object({
  proposedCode: z.string().min(1).max(MAX_PATCH_BYTES),
  explanation: z.string().min(1).max(1_000),
  accessibilityRationale: z.string().min(1).max(1_000),
  expectedVerificationCriteria: z.array(z.string().max(300)).min(1).max(4),
  assumptions: z.array(z.string().max(300)).max(8),
  manualReviewRequired: z.boolean(),
}).strict();

export class RepairError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "RepairError";
    this.code = code;
    this.status = status;
  }
}

function parseSingleElement(markup) {
  if (Buffer.byteLength(markup, "utf8") > MAX_PATCH_BYTES) {
    throw new RepairError("PATCH_TOO_LARGE", "The proposed patch is too large to review safely.");
  }
  const document = new JSDOM("<!doctype html><body></body>").window.document;
  const template = document.createElement("template");
  template.innerHTML = markup.trim();
  const elements = [...template.content.children];
  if (elements.length !== 1 || template.content.childNodes.length !== 1 || elements[0].tagName.includes("-")) {
    throw new RepairError("UNSAFE_PATCH", "A repair must replace exactly one standard HTML element.");
  }
  const element = elements[0];
  if (forbiddenTags.has(element.tagName.toLowerCase())) {
    throw new RepairError("UNSAFE_PATCH", "This repair contains an unsafe HTML element.");
  }
  for (const attribute of element.attributes) {
    const name = attribute.name.toLowerCase();
    const value = attribute.value.trim().toLowerCase();
    if (name.startsWith("on") || name === "srcdoc" || name === "formaction") {
      throw new RepairError("UNSAFE_PATCH", "Event handlers and active content are not allowed in repairs.");
    }
    if (["href", "xlink:href"].includes(name) && /^\s*javascript:/i.test(value)) {
      throw new RepairError("UNSAFE_PATCH", "Executable URLs are not allowed in repairs.");
    }
    if (name === "style" && /url\s*\(|expression\s*\(|@import/i.test(value)) {
      throw new RepairError("UNSAFE_PATCH", "Network or executable CSS is not allowed in repairs.");
    }
  }
  document.defaultView.close();
  return element;
}

function selectorElement(document, selector) {
  let matches;
  try {
    matches = document.querySelectorAll(selector);
  } catch {
    throw new RepairError("INVALID_SELECTOR", "The finding selector cannot be safely resolved.");
  }
  if (matches.length !== 1) {
    throw new RepairError("AMBIGUOUS_TARGET", "The repair target is missing or ambiguous; no source was changed.");
  }
  return matches[0];
}

function allowedAttributes(ruleId, tagName) {
  if (ruleId === "image-alt" && tagName === "IMG") return new Set(["alt"]);
  if (ruleId === "label" && ["INPUT", "SELECT", "TEXTAREA"].includes(tagName)) {
    return new Set(["aria-label", "aria-labelledby"]);
  }
  if (ruleId === "button-name" && ["BUTTON", "A", "INPUT"].includes(tagName)) return new Set(["aria-label"]);
  if (ruleId === "color-contrast") return new Set(["style"]);
  if (["html-has-lang", "html-lang-valid"].includes(ruleId) && tagName === "HTML") return new Set(["lang"]);
  return new Set();
}

function stylePropertyNames(style) {
  return Array.from({ length: style.length }, (_value, index) => style.item(index));
}

function validateStyleChange(previous, next) {
  const allowedProperties = new Set(["color", "background-color", "outline", "outline-color", "outline-style", "outline-width", "outline-offset"]);
  const before = new Map(stylePropertyNames(previous.style).map((property) => [property, previous.style.getPropertyValue(property)]));
  const after = new Map(stylePropertyNames(next.style).map((property) => [property, next.style.getPropertyValue(property)]));
  for (const property of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(property) !== after.get(property) && !allowedProperties.has(property)) {
      throw new RepairError("UNSAFE_PATCH", "The repair changes CSS outside the permitted accessibility properties.");
    }
    if ([...new Set([...before.keys(), ...after.keys()])]
      .filter((property) => before.get(property) !== after.get(property))
      .some((property) => !["color", "background-color"].includes(property))) {
      throw new RepairError("UNSAFE_PATCH", "A contrast repair may change only text or background color.");
    }
  }
}

export function validateReplacement({ originalCode, proposedCode, ruleId }) {
  if (originalCode.length >= 2_000) {
    throw new RepairError("SOURCE_TRUNCATED", "This element's source evidence is truncated and cannot be patched safely.");
  }
  const original = parseSingleElement(originalCode);
  const proposed = parseSingleElement(proposedCode);
  if (original.tagName !== proposed.tagName || original.innerHTML !== proposed.innerHTML) {
    throw new RepairError("UNSAFE_PATCH", "A repair must preserve the selected element type and all child content.");
  }

  const permitted = allowedAttributes(ruleId, original.tagName);
  const previousAttributes = new Map([...original.attributes].map(({ name, value }) => [name, value]));
  const proposedAttributes = new Map([...proposed.attributes].map(({ name, value }) => [name, value]));
  for (const attribute of new Set([...previousAttributes.keys(), ...proposedAttributes.keys()])) {
    if (previousAttributes.get(attribute) === proposedAttributes.get(attribute)) continue;
    if (!permitted.has(attribute)) {
      throw new RepairError("UNSAFE_PATCH", "A repair changes attributes outside the selected accessibility issue.");
    }
    if (attribute === "style") validateStyleChange(original, proposed);
  }

  if (proposedCode === originalCode) {
    throw new RepairError("NO_SAFE_PATCH", "No safe automatic change is available for this finding.");
  }
  return proposed.outerHTML;
}

function cleanText(value, maximum = 300) {
  return value.replace(/\s+/g, " ").trim().split("").filter((character) => {
    const code = character.charCodeAt(0);
    return code >= 32 && code !== 127;
  }).join("").slice(0, maximum);
}

function isOpaqueColor(value) {
  const match = typeof value === "string" ? value.match(/^rgba?\((.+)\)$/i) : null;
  if (!match) return false;
  const parts = match[1].split(",").map((part) => part.trim());
  return parts.length === 3 || Number(parts[3]) === 1;
}

function matchedCssRules(document, target, cssSource, sourceLabel) {
  const styleElement = cssSource ? document.createElement("style") : null;
  if (styleElement) {
    if (Buffer.byteLength(cssSource, "utf8") > MAX_PROVIDED_CSS_BYTES
      || /@import\b|expression\s*\(|<\/style|javascript:/i.test(cssSource)) {
      document.defaultView.close();
      throw new RepairError("UNSAFE_CSS_SOURCE", "The supplied stylesheet is too large or contains unsupported active CSS.");
    }
    styleElement.textContent = cssSource;
    document.head.append(styleElement);
  }

  const matches = [];
  const readRules = (rules, source) => {
    for (const rule of rules) {
      if (rule.selectorText && rule.style) {
        let matchesTarget = false;
        try {
          matchesTarget = Boolean(target.closest(rule.selectorText));
        } catch {
          throw new RepairError("INVALID_CSS_SELECTOR", "The supplied stylesheet contains a selector that cannot be safely evaluated.");
        }
        if (matchesTarget) {
          const declarations = {};
          for (const property of ["color", "background-color", "font-size", "font-weight"]) {
            const value = rule.style.getPropertyValue(property);
            if (value) declarations[property] = value;
          }
          if (Object.keys(declarations).length) {
            matches.push({
              selector: cleanText(rule.selectorText, 300),
              scope: target.matches(rule.selectorText) ? "element" : "ancestor",
              source,
              declarations,
            });
          }
        }
      } else if (rule.cssRules) {
        readRules(rule.cssRules, source);
      }
    }
  };

  for (const sheet of [...document.styleSheets]) {
    try {
      readRules(sheet.cssRules, sheet === styleElement?.sheet ? sourceLabel : "controlled artifact stylesheet");
    } catch (error) {
      if (error instanceof RepairError) throw error;
    }
  }
  if (styleElement && !matches.some((rule) => rule.source === sourceLabel)) {
    styleElement.remove();
    throw new RepairError("CSS_SELECTOR_NOT_FOUND", "The supplied stylesheet has no safely matched rule for the affected element.");
  }
  return matches;
}

function inspectRenderedStyles(document, target) {
  const style = document.defaultView.getComputedStyle(target);
  let effectiveBackground = null;
  let backgroundUncertain = false;
  let ancestor = target;
  while (ancestor && ancestor.nodeType === 1) {
    const computed = document.defaultView.getComputedStyle(ancestor);
    if ((computed.backgroundImage && computed.backgroundImage !== "none")
      || (computed.opacity && Number(computed.opacity) < 1)) backgroundUncertain = true;
    if (!effectiveBackground && isOpaqueColor(computed.backgroundColor)) {
      effectiveBackground = computed.backgroundColor;
    }
    ancestor = ancestor.parentElement;
  }
  return {
    color: style.color,
    backgroundColor: style.backgroundColor,
    effectiveBackground: backgroundUncertain ? null : effectiveBackground,
    backgroundUncertain,
    fontSize: style.fontSize,
    fontWeight: style.fontWeight,
    inlineStyle: target.getAttribute("style") ?? "",
  };
}

function relevantCssDeclarations(rules) {
  return rules
    .filter(({ declarations }) => declarations.color || declarations["background-color"])
    .map(({ selector, source, declarations }) => ({
      selector,
      source,
      declarations: Object.fromEntries(
        Object.entries(declarations).filter(([property]) => ["color", "background-color"].includes(property)),
      ),
    }));
}

export function prepareFindingContext(audit, violation, nodeIndex, cssSource = "") {
  const node = violation.nodes[nodeIndex];
  if (!node) throw new RepairError("FINDING_NOT_FOUND", "The selected affected element is not available.", 404);
  if (!node.selector || !node.html) {
    throw new RepairError("FINDING_NOT_PATCHABLE", "This finding does not include enough source evidence for a scoped repair.", 422);
  }
  const document = new JSDOM(audit.sourceType === "html"
    ? audit.previewHtml
    : `<!doctype html><html><body>${node.html}</body></html>`).window.document;
  const target = audit.sourceType === "html"
    ? selectorElement(document, node.selector)
    : document.body.firstElementChild;
  if (!target || (audit.sourceType === "url" && document.body.children.length !== 1)) {
    document.defaultView.close();
    throw new RepairError("FINDING_NOT_PATCHABLE", "The affected element cannot be isolated safely for a local repair.", 422);
  }
  if (target.outerHTML !== node.html) {
    document.defaultView.close();
    throw new RepairError("SOURCE_CHANGED", "The finding source no longer matches the audited element. Run a fresh audit before repairing.");
  }
  const parent = target.parentElement;
  const contextHtml = parent?.outerHTML.slice(0, MAX_CONTEXT_BYTES) ?? target.outerHTML;
  const siblings = parent ? [...parent.children] : [];
  const targetIndex = siblings.indexOf(target);
  const previousLabel = targetIndex > 0 ? siblings[targetIndex - 1] : null;
  const nearbyLabelText = previousLabel?.tagName === "LABEL" && !previousLabel.htmlFor
    ? cleanText(previousLabel.textContent, 80)
    : "";
  let styleEvidence = null;
  let cssEvidence = null;
  if (violation.id === "color-contrast") {
    try {
      const localRules = matchedCssRules(document, target, cssSource, "developer-provided stylesheet");
      const localStyles = inspectRenderedStyles(document, target);
      const scannedStyles = node.styleEvidence ?? {};
      const rulesByDeclaration = new Map(
        (scannedStyles.matchedRules ?? []).map((rule) => [`${rule.selector}:${JSON.stringify(rule.declarations)}`, rule]),
      );
      for (const rule of localRules) {
        rulesByDeclaration.set(`${rule.selector}:${JSON.stringify(rule.declarations)}`, rule);
      }
      styleEvidence = {
        ...scannedStyles,
        ...localStyles,
        color: localStyles.color || scannedStyles.color || null,
        backgroundColor: localStyles.backgroundColor || scannedStyles.backgroundColor || null,
        effectiveBackground: localStyles.effectiveBackground ?? scannedStyles.effectiveBackground ?? null,
        fontSize: localStyles.fontSize || scannedStyles.fontSize || null,
        fontWeight: localStyles.fontWeight || scannedStyles.fontWeight || null,
        backgroundUncertain: localStyles.backgroundUncertain || scannedStyles.backgroundUncertain === true,
        matchedRules: [...rulesByDeclaration.values()].slice(0, 20),
      };
      const declarations = relevantCssDeclarations(styleEvidence.matchedRules);
      const inlineDeclarations = [];
      let inlineAncestor = target;
      while (inlineAncestor && inlineAncestor.nodeType === 1) {
        for (const property of ["color", "background-color"]) {
          const value = inlineAncestor.style.getPropertyValue(property);
          if (value) inlineDeclarations.push({
            property,
            value,
            scope: inlineAncestor === target ? "element" : "ancestor",
          });
        }
        inlineAncestor = inlineAncestor.parentElement;
      }
      const sourceKnown = inlineDeclarations.length > 0 || declarations.length > 0;
      cssEvidence = {
        targetSelector: node.selector,
        sourceKnown,
        declarations,
        originalDeclaration: [
          ...inlineDeclarations.map(({ property, value, scope }) => `${scope} style="${property}: ${value};"`),
          ...declarations.map(({ selector, scope, declarations: values }) => (
            `${selector}${scope === "ancestor" ? " (ancestor)" : ""} { ${Object.entries(values).map(([property, value]) => `${property}: ${value};`).join(" ")} }`
          )),
        ].join("\n"),
        suppliedStylesheet: Boolean(cssSource),
      };
      if (cssSource && !declarations.some(({ source }) => source === "developer-provided stylesheet")) {
        document.defaultView.close();
        throw new RepairError("CSS_SELECTOR_NOT_FOUND", "The supplied stylesheet has no safely matched rule for the affected element.");
      }
    } catch (error) {
      if (error instanceof RepairError) {
        if (error.code !== "CSS_SELECTOR_NOT_FOUND" || !cssSource) document.defaultView.close();
        throw error;
      }
      document.defaultView.close();
      throw error;
    }
  }
  const context = {
    ruleId: violation.id,
    impact: violation.impact,
    wcagTags: violation.wcagCriteria,
    description: cleanText(violation.description, 500),
    element: target.outerHTML,
    selector: node.selector,
    failureSummary: cleanText(node.failureSummary, 800),
    surroundingHtml: contextHtml,
    relatedElements: (node.relatedNodes ?? []).slice(0, 3).map((related) => ({
      targets: related.targets.slice(0, 3),
      html: related.html.slice(0, 500),
      failureSummary: cleanText(related.failureSummary, 400),
    })),
    nearbyLabelText,
    ...(styleEvidence ? { styleEvidence } : {}),
    ...(cssEvidence ? { cssEvidence } : {}),
  };
  document.defaultView.close();
  const repairSelector = audit.sourceType === "html" ? node.selector : `body > ${target.tagName.toLowerCase()}`;
  return { node, targetCode: node.html, context, nearbyLabelText, repairSelector };
}

export function deterministicProposal({ ruleId, originalCode, nearbyLabelText, styleEvidence, cssEvidence }) {
  if (ruleId === "label" && nearbyLabelText) {
    const updated = parseSingleElement(originalCode);
    if (["INPUT", "SELECT", "TEXTAREA"].includes(updated.tagName) && !updated.hasAttribute("aria-label")) {
      updated.setAttribute("aria-label", nearbyLabelText);
      return {
        proposedCode: updated.outerHTML,
        explanation: "Use the immediately preceding, unassociated visible label as the control's accessible name.",
        accessibilityRationale: "An explicit accessible name lets assistive technology identify the form control.",
        expectedVerificationCriteria: [`The ${ruleId} rule no longer reports this selected control after a real rescan.`],
        assumptions: ["The adjacent label text accurately describes this control."],
        manualReviewRequired: true,
        applicable: true,
      };
    }
  }

  if (ruleId === "color-contrast") {
    const manual = (explanation) => ({
      proposedCode: originalCode,
      explanation,
      accessibilityRationale: "A contrast fix requires an identified CSS declaration and a known rendered background.",
      expectedVerificationCriteria: ["Re-scan the controlled artifact and confirm the color-contrast finding is resolved."],
      assumptions: ["The relevant stylesheet and rendered background must be reviewed by a developer."],
      manualReviewRequired: true,
      applicable: false,
    });
    if (!cssEvidence?.sourceKnown) {
      return manual("No editable CSS declaration was identified. Provide the relevant stylesheet so a scoped override can be reviewed.");
    }
    if (!styleEvidence?.color || !styleEvidence?.effectiveBackground || styleEvidence.backgroundUncertain) {
      return manual("The rendered foreground or effective background is not sufficiently certain to calculate a safe contrast fix.");
    }

    const fontSize = Number.parseFloat(styleEvidence.fontSize) || 16;
    const isBold = Number.parseInt(styleEvidence.fontWeight, 10) >= 700 || styleEvidence.fontWeight === "bold";
    const current = calculateContrast(styleEvidence.color, styleEvidence.effectiveBackground, fontSize, isBold);
    if (current.status !== "fail") {
      return manual("The available CSS evidence does not confirm a failing contrast ratio; review the source and rendered page manually.");
    }
    const candidates = ["#000000", "#ffffff"]
      .map((color) => ({ color, contrast: calculateContrast(color, styleEvidence.effectiveBackground, fontSize, isBold) }))
      .filter(({ contrast }) => contrast.status === "pass");
    if (!candidates.length) return manual("Neither a black nor white text override meets the applicable contrast threshold for the measured background.");

    const parsed = parseSingleElement(originalCode);
    parsed.style.setProperty("color", candidates[0].color);
    return {
      proposedCode: parsed.outerHTML,
      explanation: "Add a calculated text-color override to the affected element in the controlled artifact.",
      accessibilityRationale: `The candidate contrast ratio is ${candidates[0].contrast.ratio}:1; the required threshold is ${candidates[0].contrast.requiredRatio}:1.`,
      expectedVerificationCriteria: ["The actual controlled-artifact rescan no longer reports this color-contrast finding."],
      assumptions: ["The supplied or embedded CSS evidence reflects the intended source; the generated override affects only this controlled artifact."],
      manualReviewRequired: true,
      applicable: true,
      contrastCheck: { ...candidates[0].contrast, status: "candidate_pass_not_verified" },
    };
  }

  return {
    proposedCode: originalCode,
    explanation: "No safe automatic patch can be inferred from this finding alone.",
    accessibilityRationale: "The repair needs content or design context that cannot be reliably inferred from the HTML evidence.",
    expectedVerificationCriteria: [`A follow-up scan must confirm whether the ${ruleId} finding remains.`],
    assumptions: [],
    manualReviewRequired: true,
    applicable: false,
  };
}

export function normalizeProposal(value, originalCode, ruleId) {
  const parsed = proposalSchema.safeParse(value);
  if (!parsed.success) throw new RepairError("INVALID_SUGGESTION", "The repair suggestion did not match the required safe output format.", 502);
  if (ruleId === "image-alt" && parsed.data.proposedCode !== originalCode) {
    parsed.data.manualReviewRequired = true;
    parsed.data.assumptions = [...new Set([...parsed.data.assumptions, "Verify that this alternative text accurately communicates the image's meaning in context."])].slice(0, 8);
  }
  if (parsed.data.proposedCode === originalCode) {
    return { ...parsed.data, applicable: false };
  }
  try {
    const validatedCode = validateReplacement({
      originalCode,
      proposedCode: parsed.data.proposedCode,
      ruleId,
    });
    if (validatedCode === originalCode) {
      return {
        ...parsed.data,
        proposedCode: originalCode,
        applicable: false,
      };
    }
    if (ruleId === "color-contrast") {
      const original = parseSingleElement(originalCode);
      const proposed = parseSingleElement(validatedCode);
      const changedStyleProperties = [...new Set([...stylePropertyNames(original.style), ...stylePropertyNames(proposed.style)])]
        .filter((property) => original.style.getPropertyValue(property) !== proposed.style.getPropertyValue(property));
      if (changedStyleProperties.length !== 1 || !["color", "background-color"].includes(changedStyleProperties[0])) {
        return {
          ...parsed.data,
          proposedCode: originalCode,
          explanation: "The generated CSS patch changed more than one contrast-related declaration and was rejected.",
          manualReviewRequired: true,
          applicable: false,
        };
      }
    }
    return { ...parsed.data, proposedCode: validatedCode, applicable: true };
  } catch (error) {
    if (error instanceof RepairError) {
      return {
        proposedCode: originalCode,
        explanation: "The generated change was rejected because it was not safely scoped to the selected element.",
        accessibilityRationale: "Only a verified change to this finding's permitted attributes can be offered for application.",
        assumptions: [],
        manualReviewRequired: true,
        applicable: false,
        rejectionReason: error.code,
      };
    }
    throw error;
  }
}

export function validateContrastCandidate(proposal, originalCode, styleEvidence) {
  if (!proposal.applicable || !styleEvidence?.effectiveBackground || styleEvidence.backgroundUncertain) {
    return { ...proposal, applicable: false };
  }
  const proposed = parseSingleElement(proposal.proposedCode);
  const original = parseSingleElement(originalCode);
  const colorChanged = proposed.style.getPropertyValue("color") !== original.style.getPropertyValue("color");
  const backgroundChanged = proposed.style.getPropertyValue("background-color") !== original.style.getPropertyValue("background-color");
  const foreground = colorChanged
    ? proposed.style.getPropertyValue("color")
    : styleEvidence.color;
  const background = backgroundChanged
    ? proposed.style.getPropertyValue("background-color")
    : styleEvidence.effectiveBackground;
  const fontSize = Number.parseFloat(styleEvidence.fontSize) || 16;
  const isBold = Number.parseInt(styleEvidence.fontWeight, 10) >= 700 || styleEvidence.fontWeight === "bold";
  const contrastCheck = calculateContrast(foreground, background, fontSize, isBold);
  return {
    ...proposal,
    contrastCheck: {
      ...contrastCheck,
      status: contrastCheck.status === "pass" ? "candidate_pass_not_verified" : contrastCheck.status,
    },
    applicable: contrastCheck.status === "pass",
    manualReviewRequired: true,
  };
}

export function applyScopedReplacement(source, selector, originalCode, proposedCode, ruleId) {
  const replacement = validateReplacement({ originalCode, proposedCode, ruleId });
  const document = new JSDOM(source).window.document;
  const target = selectorElement(document, selector);
  if (target.outerHTML !== originalCode) {
    document.defaultView.close();
    throw new RepairError("SOURCE_CHANGED", "The selected element changed after the suggestion was created. No patch was applied.");
  }
  const replacementElement = parseSingleElement(replacement).cloneNode(true);
  target.replaceWith(replacementElement);
  const updated = document.documentElement.outerHTML;
  document.defaultView.close();
  return updated;
}

export const repairInputSchema = z.object({
  auditId: z.string().uuid(),
  artifactId: z.string().uuid(),
  violationId: z.string().min(1).max(100),
  nodeIndex: z.number().int().min(0).max(39).default(0),
  cssSource: z.string().min(1).max(MAX_PROVIDED_CSS_BYTES).optional(),
}).strict();

export const applyRepairSchema = z.object({
  manualReviewConfirmed: z.boolean(),
  reviewedPatchHash: z.string().regex(/^[a-f0-9]{64}$/),
  artifactVersion: z.number().int().positive(),
}).strict();

export const controlledArtifactSchema = z.object({
  name: z.string().trim().min(1).max(100),
  html: z.string().min(1).max(300_000).refine(
    (value) => Buffer.byteLength(value, "utf8") <= 300_000,
    "HTML must be 300,000 bytes or fewer.",
  ),
  sourceAuditId: z.string().uuid().optional(),
}).strict();
