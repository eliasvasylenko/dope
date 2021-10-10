import { place, render, ElementContent, Placement } from "./dope.js";

export function makeCache<K extends object, V>(populate: (key: K) => V): (key: K) => V { // eslint-disable-line
    const cache = new WeakMap<K, V>();
    return key => {
        let element = cache.get(key);
        if (!element) {
            element = populate(key);
            cache.set(key, element);
        }
        return element;
    }
}

export function html(templateStrings: TemplateStringsArray, ...values: unknown[]): () => HTMLContent {
    return makeHTMLAction(templateStrings, values);
}

interface SlotInfo {
    regexp: RegExp;
    name(index: number): string;
}

const slotsKey = Symbol('slots');
type Slotted<T> = T & {
    [slotsKey]: {
        elementQuery: string;
        elementUpdate: (element: Element) => (values: unknown[]) => void;
    }[];
};

// This function should only be called once for each
// string template as it is initialized. The cost is
// amortized over the lifetime of the template so we
// also front-load as much computation as we can.
//
// We parse the DOM using functionality built into the
// platform rather than burdening ourselves with the
// technical debt of a custom implementation.
const templateCache =
    makeCache((document: Document) =>
        makeCache((templateStrings: TemplateStringsArray) =>
            composeTemplate(document, templateStrings)));
function composeTemplate(document: Document, templateStrings: TemplateStringsArray) {
    const slotInfo = nameSlots(templateStrings);

    let i = 0;
    const templateHTML = join(templateStrings, () => slotInfo.name(i++));

    const template = document.createElement('template') as Slotted<HTMLTemplateElement>;
    template.innerHTML = templateHTML;
    template[slotsKey] = [];
    wireSlots(template, slotInfo);

    return template;
}

// Find an appropriate list of slot names. We must
// avoid collision with legitimate text content. We do
// this by starting each name with a sequence of '{'
// longer than any contained in the template string.
const postfix = '}';
function nameSlots(templateStrings: TemplateStringsArray) {
    const prefix = '{' + templateStrings
        .flatMap(string => string.match(/{*/g) ?? '') // TODO make aware of &; encoding of '{'
        .reduce((a, b) => (a.length > b.length) ? a : b, '');

    const slotInfo: SlotInfo = {
        regexp: RegExp(prefix + '([0-9]*)' + postfix, 'm'),
        name: (index: number) => prefix + index + postfix
    };

    return slotInfo;
}

function wireSlots(template: Slotted<HTMLTemplateElement>, slots: SlotInfo) {
    const view = global.window || template?.ownerDocument?.defaultView;

    const nodes = template.ownerDocument.createNodeIterator(template.content, view.NodeFilter.SHOW_ALL);

    let node;
    while ((node = nodes.nextNode())) {
        if (node instanceof view.Text && node.nodeValue) {
            const { firstSlot, strings } = findStringSlots(slots, node.nodeValue);
            if (firstSlot < 0)
                continue;

            const fragment = template.ownerDocument.createDocumentFragment();

            fragment.append(strings[0]);
            for (const [i, s] of strings.slice(1).entries()) {
                const slot = template.ownerDocument.createElement('slot');
                const variableIndex = firstSlot + i;
                slot.name = variableIndex.toString();
                fragment.append(slot, s);

                template[slotsKey].push({
                    elementQuery: `slot[name="${variableIndex}"]`,
                    elementUpdate: (element: Element) => {
                        const marker = template.ownerDocument.createComment(`slot-${variableIndex}`) as Containing<Comment>;
                        element.replaceWith(marker);

                        marker[contentKey] = new ElementContent();

                        return (values: unknown[]) => render(
                            Placement.Element,
                            values[variableIndex],
                            () => marker[contentKey],
                            content => {
                                if (content === marker[contentKey])
                                    return;
                                marker[contentKey].move();
                                marker[contentKey] = content;
                                marker.parentNode?.insertBefore(marker[contentKey].move(), marker.nextSibling);
                            });
                    }
                });
            }

            node.parentNode?.insertBefore(fragment, node);
            node.remove();

            continue;
        }

        if (!(node instanceof view.Element))
            continue;

        const attrs = node.attributes;
        for (let a = 0; a < attrs?.length; a++) {
            const attribute = attrs[a];
            if (!attribute.specified)
                continue;

            const attributeName = attribute.name;
            const match = slots.regexp.exec(attributeName);
            if (match) {
                console.assert(match[0] === match[1], 'partial expression in attribute position is illegal');
                // TODO slot in TAG position
            }

            const { firstSlot, strings } = findStringSlots(slots, attribute.value);
            if (firstSlot < 0)
                continue;

            template[slotsKey].push({
                elementQuery: `[${attributeName}="${attribute.value}"]`,
                elementUpdate: (element: Element) => {
                    const e = element;
                    return (values: unknown[]) => {
                        let s = firstSlot;
                        const a = join(strings, () => values[s++]);
                        e.setAttribute(attributeName, a);
                    };
                }
            });
        }
    }
}

function join<T>(strings: ReadonlyArray<string>, values: () => T) {
    const length = strings.length - 1;
    let string = '';
    for (let i = 0; i < length; i++) {
        string += strings[i] + values();
    }
    string += strings[length];
    return string;
}

function findStringSlots(slotInfo: SlotInfo, string: string) {
    const match = slotInfo.regexp.exec(string);
    if (match == null)
        return { firstSlot: -1, strings: [] };

    const strings = [];
    const firstSlot = parseInt(match[1]);

    let fromIndex = 0;
    let index = match.index;
    let name = match[0];
    let slot = firstSlot;
    do {
        strings.push(string.slice(fromIndex, index));

        fromIndex = index + name.length;
        name = slotInfo.name(++slot);
        index = string.indexOf(name, fromIndex);
    } while (index >= 0);
    strings.push(string.slice(fromIndex));

    return { firstSlot, strings };
}

const contentKey = Symbol('content');
type Containing<T> = T & {
    [contentKey]: ElementContent;
};

class HTMLContent extends ElementContent {
    template: HTMLTemplateElement;
    #beginMarker: Comment;
    #endMarker: Comment;
    #patches: ((action: unknown[]) => void)[];

    constructor(template: Slotted<HTMLTemplateElement>, values: unknown[]) {
        super();
        this.template = template;

        this.#beginMarker = template.ownerDocument.createComment('html-begin');
        this.#endMarker = template.ownerDocument.createComment('html-end');

        const fragment = template.ownerDocument.createDocumentFragment();
        fragment.append(
            this.#beginMarker,
            template.content.cloneNode(true),
            this.#endMarker);

        this.#patches = template[slotsKey].map(wire => {
            const element = fragment.querySelector(wire.elementQuery);
            if (!element) throw ''; // TODO
            return wire.elementUpdate(element);
        });

        this.patch(values);
    }

    nodes() {
        const e = [];
        let n: Node = this.#beginMarker;
        do {
            e.push(n);
            if (n.nextSibling == null) throw ''; // TODO
            n = n.nextSibling;
        } while (n !== this.#endMarker);
        e.push(this.#endMarker);
        return e;
    }

    patch(values: unknown[]) {
        for (const patch of this.#patches) { patch(values); }
    }
}
function makeHTMLAction(templateStrings: TemplateStringsArray, values: unknown[]) {
    const t = templateStrings;
    const v = values;

    let template: Slotted<HTMLTemplateElement> | undefined;
    return () => {
        template = template || templateCache(place().document)(t);

        const content = place().priorContent;
        if ((content instanceof HTMLContent)
            && (content.template === template)) {
            content.patch(v);
            return content;
        } else {
            return new HTMLContent(template, v);
        }
    }
}
