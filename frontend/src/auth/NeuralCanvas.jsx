import { useEffect, useRef } from "react";

const COLORS = ["255, 57, 68", "230, 36, 41", "255, 142, 147"];

function createNodes(width, height, count) {
  return Array.from({ length: count }, (_, index) => ({
    x: Math.random() * width,
    y: Math.random() * height,
    originX: Math.random() * width,
    originY: Math.random() * height,
    phase: Math.random() * Math.PI * 2,
    speed: 0.00012 + Math.random() * 0.00022,
    radius: index % 9 === 0 ? 2.2 : 1 + Math.random() * 0.8,
    color: COLORS[index % COLORS.length],
  }));
}

export default function NeuralCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof window.CanvasRenderingContext2D === "undefined") return undefined;
    const context = canvas.getContext("2d");
    if (!context) return undefined;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const smallScreen = window.matchMedia("(max-width: 760px)");
    const pointer = { x: -1000, y: -1000, active: false };
    let nodes = [];
    let width = 0;
    let height = 0;
    let frame = 0;
    let lastFrameAt = 0;

    function resize() {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.7);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      nodes = createNodes(width, height, smallScreen.matches ? 36 : 66);
      draw(performance.now(), true);
    }

    function draw(time, staticFrame = false) {
      context.clearRect(0, 0, width, height);
      const motionOn = !reducedMotion.matches && !staticFrame;
      for (const node of nodes) {
        const drift = motionOn ? Math.sin(time * node.speed + node.phase) : 0;
        node.x = node.originX + Math.cos(node.phase + time * node.speed) * (motionOn ? 12 : 0);
        node.y = node.originY + drift * (motionOn ? 10 : 0);
        if (pointer.active && motionOn) {
          const dx = node.x - pointer.x;
          const dy = node.y - pointer.y;
          const distance = Math.hypot(dx, dy);
          if (distance < 150 && distance > 0) {
            const influence = (1 - distance / 150) * 10;
            node.x += (dx / distance) * influence;
            node.y += (dy / distance) * influence;
          }
        }
      }

      const maxDistance = smallScreen.matches ? 118 : 142;
      for (let first = 0; first < nodes.length; first += 1) {
        const node = nodes[first];
        for (let second = first + 1; second < nodes.length; second += 1) {
          const other = nodes[second];
          const distance = Math.hypot(node.x - other.x, node.y - other.y);
          if (distance >= maxDistance) continue;
          const opacity = (1 - distance / maxDistance) * 0.22;
          context.beginPath();
          context.moveTo(node.x, node.y);
          context.lineTo(other.x, other.y);
          context.strokeStyle = `rgba(${node.color}, ${opacity})`;
          context.lineWidth = 0.7;
          context.stroke();
        }
      }

      for (const node of nodes) {
        context.beginPath();
        context.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
        context.fillStyle = `rgba(${node.color}, ${node.radius > 2 ? 0.78 : 0.48})`;
        context.fill();
        if (node.radius > 2) {
          context.beginPath();
          context.arc(node.x, node.y, node.radius * 3.5, 0, Math.PI * 2);
          context.fillStyle = `rgba(${node.color}, 0.055)`;
          context.fill();
        }
      }
    }

    function animate(time) {
      if (time - lastFrameAt > 32) {
        draw(time);
        lastFrameAt = time;
      }
      if (!reducedMotion.matches) frame = window.requestAnimationFrame(animate);
    }

    function onPointerMove(event) {
      const bounds = canvas.getBoundingClientRect();
      pointer.x = event.clientX - bounds.left;
      pointer.y = event.clientY - bounds.top;
      pointer.active = true;
    }

    function onPointerLeave() {
      pointer.active = false;
    }

    function onMotionChange() {
      window.cancelAnimationFrame(frame);
      if (reducedMotion.matches) draw(performance.now(), true);
      else frame = window.requestAnimationFrame(animate);
    }

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    if (resizeObserver) resizeObserver.observe(canvas);
    else window.addEventListener("resize", resize);
    canvas.addEventListener("pointermove", onPointerMove, { passive: true });
    canvas.addEventListener("pointerleave", onPointerLeave);
    reducedMotion.addEventListener("change", onMotionChange);
    smallScreen.addEventListener("change", resize);
    resize();
    if (!reducedMotion.matches) frame = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      if (!resizeObserver) window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      reducedMotion.removeEventListener("change", onMotionChange);
      smallScreen.removeEventListener("change", resize);
    };
  }, []);

  return <canvas className="auth-neural-canvas" ref={canvasRef} aria-hidden="true" />;
}
