export function submitOnEnter(event: KeyboardEvent): void {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
  const target = event.currentTarget;
  if (!(target instanceof HTMLTextAreaElement) || !target.form) return;
  event.preventDefault();
  target.form.requestSubmit();
}
