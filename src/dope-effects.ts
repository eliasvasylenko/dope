import { makeCache } from "./dope-html.js";

export const sym = makeCache((templateStrings: TemplateStringsArray) => Symbol(templateStrings[0]));
