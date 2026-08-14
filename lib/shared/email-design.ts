export function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderBrandedEmail(input: {
  origin: string;
  label: string;
  title: string;
  contentHtml: string;
  meta?: string;
  action?: { label: string; url: string };
  note?: string;
}): string {
  const origin = input.origin.replace(/\/$/, "");
  const action = input.action
    ? `<p style="margin:24px 0 0"><a href="${escapeEmailHtml(input.action.url)}" style="color:#b45309;font:600 15px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;text-decoration:underline;text-underline-offset:3px">${escapeEmailHtml(input.action.label)} →</a></p>`
    : "";

  return `<div style="margin:0;background:#fafaf9;color:#1c1917">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fafaf9">
    <tr>
      <td align="center" style="padding:32px 20px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:560px;text-align:left">
          <tr>
            <td>
              <a href="${escapeEmailHtml(origin)}" style="display:inline-block;text-decoration:none">
                <img src="${escapeEmailHtml(`${origin}/email-logo.png`)}" width="112" height="112" alt="milk &amp; henny" style="display:block;border:0;width:112px;height:112px">
              </a>
              <p style="margin:24px 0 8px;color:#78716c;font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;text-transform:lowercase">${escapeEmailHtml(input.label)}</p>
              <h1 style="margin:0;color:#1c1917;font:400 30px/1.15 Georgia,serif">${escapeEmailHtml(input.title)}</h1>
              ${input.meta ? `<p style="margin:8px 0 0;color:#78716c;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace">${escapeEmailHtml(input.meta)}</p>` : ""}
              <div style="margin-top:24px;color:#292524;font:17px/1.65 Georgia,serif">
                ${input.contentHtml}
                ${action}
                ${input.note ? `<p style="margin:18px 0 0;color:#78716c;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace">${escapeEmailHtml(input.note)}</p>` : ""}
              </div>
              <div style="margin-top:28px;border-top:1px solid #e7e5e4;padding-top:16px;color:#a8a29e;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace">
                milk &amp; henny · <a href="mailto:hello@milkandhenny.com" style="color:#78716c">hello@milkandhenny.com</a>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</div>`;
}
