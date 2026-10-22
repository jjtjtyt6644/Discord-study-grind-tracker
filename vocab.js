// "Studying" vs "Working" mode: same app, different words. Rewrites study → work in any text,
// keeping the case and word form (Study→Work, studied→worked, studying→working, studies→works).
const FORMS = { y: "", ied: "ed", ying: "ing", ies: "s" };

export function vocab(text, activity) {
  if (activity !== "work" || typeof text !== "string") return text;
  return text.replace(/\b([Ss])tud(y|ied|ying|ies)\b/g, (_, s, form) => `${s === "S" ? "W" : "w"}ork${FORMS[form]}`);
}
