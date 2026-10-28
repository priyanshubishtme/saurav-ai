export function handleRadioGroupKeyDown(event, values, selectedValue, onSelect) {
  const currentIndex = values.indexOf(selectedValue);
  let nextIndex;

  if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = values.length - 1;
  else if (["ArrowRight", "ArrowDown"].includes(event.key)) nextIndex = (currentIndex + 1) % values.length;
  else if (["ArrowLeft", "ArrowUp"].includes(event.key)) nextIndex = (currentIndex - 1 + values.length) % values.length;
  else return;

  event.preventDefault();
  onSelect(values[nextIndex]);
  event.currentTarget.parentElement.querySelectorAll('[role="radio"]')[nextIndex]?.focus();
}
