/**
 * Puts keyboard focus back on the button of a time (after the panel it opened closes). The time may not be in the
 * grid for a moment (a released hold returns to it after the live refresh), so this waits up to two seconds.
 */
export const focusSlot = (s: { doctorId: string; startsAt: string }): void => {
  let tries = 0;
  const attempt = (): void => {
    const el = [...document.querySelectorAll<HTMLButtonElement>('[data-testid="slot"]')].find(
      (b) => b.dataset['doctor'] === s.doctorId && b.dataset['start'] === s.startsAt,
    );
    if (el) el.focus();
    else if (++tries < 40) setTimeout(attempt, 50);
  };
  attempt();
};
