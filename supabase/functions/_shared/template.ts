// Message templates.
//   {name}, {first_name}, {day}, {date}  – variables
//   {Hi|Hey|Hello} {first_name}           – random variation (spintax), may be nested
// Unknown {tokens} without a '|' are left untouched.

export interface TemplateVars {
  name?: string;
  first_name?: string;
  day?: string;
  date?: string;
  [key: string]: string | undefined;
}

export function templateVars(recipientName: string, at: Date, timezone: string): TemplateVars {
  return {
    name: recipientName,
    first_name: recipientName.split(/\s+/)[0] ?? recipientName,
    day: new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: timezone }).format(at),
    date: new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: timezone }).format(at),
  };
}

export function renderTemplate(template: string, vars: TemplateVars, random: () => number = Math.random): string {
  let out = template;
  // Resolve innermost braces first so variations can contain variables and nest.
  const inner = /\{([^{}]*)\}/g;
  for (let guard = 0; guard < 50 && inner.test(out); guard++) {
    inner.lastIndex = 0;
    out = out.replace(inner, (_whole, body: string) => {
      if (body.includes('|')) {
        const options = body.split('|');
        return options[Math.floor(random() * options.length)];
      }
      const key = body.trim().toLowerCase();
      return vars[key] ?? `\u0000${body}\u0001`; // protect unknown tokens from re-matching
    });
  }
  return out.replace(/\u0000/g, '{').replace(/\u0001/g, '}').replace(/[ \t]{2,}/g, ' ').trim();
}
