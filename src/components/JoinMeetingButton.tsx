"use client";

// Opens a Teams meeting in a focused popup window layered over the LMS, so
// desktop users stay in context instead of losing the app in a new tab.
//
// Reality check (Microsoft's limitation, not ours):
//   - Desktop: the meeting runs in the popup window via "continue on browser".
//   - Mobile: browsers can't run Teams meetings, so window.open hands off to
//     the Teams app. The fallback below covers popup-blocked / mobile cases.

export function JoinMeetingButton({
  joinUrl,
  className,
  title = "Join the Teams meeting",
  children,
}: {
  joinUrl: string;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const open = () => {
    const w = Math.min(1180, window.screen.availWidth - 60);
    const h = Math.min(800, window.screen.availHeight - 80);
    const left = Math.round(
      window.screenX + Math.max(0, (window.outerWidth - w) / 2)
    );
    const top = Math.round(
      window.screenY + Math.max(0, (window.outerHeight - h) / 2)
    );

    const win = window.open(
      joinUrl,
      "indefine-teams-meeting",
      `width=${w},height=${h},left=${left},top=${top}`
    );

    if (win) {
      // Prevent the meeting window from touching the LMS window.
      try {
        win.opener = null;
      } catch {
        /* some browsers disallow — harmless */
      }
      win.focus?.();
    } else {
      // Popup blocked, or a mobile browser that hands off to the Teams app.
      window.open(joinUrl, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <button type="button" onClick={open} title={title} className={className}>
      {children}
    </button>
  );
}
