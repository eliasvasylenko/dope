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
    names: string[];
    indices: Record<string, number>;
}

const slotsKey = Symbol('slots');
const elementsKey = Symbol('element-wires');
const attributesKey = Symbol('attribute-wires');
type Slotted<T> = T & {
    [slotsKey]: SlotInfo;
    [elementsKey]: {
        query: string;
        variableIndex: number;
    }[];
    [attributesKey]: {
        query: string;
        updateVariables: (element: Element) => (values: unknown[]) => void;
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

    let templateString = templateStrings[0];
    let i = 0;
    for (const string of templateStrings.slice(1)) {
        templateString += slotInfo.names[i++] + string;
    }

    const template = document.createElement('template') as Slotted<HTMLTemplateElement>;
    template.innerHTML = templateString;
    template[slotsKey] = slotInfo;
    template[elementsKey] = [];
    template[attributesKey] = [];
    wireSlots(template);

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
    const count = templateStrings.length - 1;

    const slotInfo: SlotInfo = {
        regexp: RegExp(prefix + '([0-9]*)' + postfix, 'm'),
        names: [],
        indices: {}
    };
    for (let i = slotInfo.names.length; i < count; i++) {
        const name = prefix + i + postfix;
        slotInfo.names.push(name);
        slotInfo.indices[name] = i;
    }
    return slotInfo;
}

function wireSlots(template: Slotted<HTMLTemplateElement>) {
    const view = global.window || template?.ownerDocument?.defaultView;

    const nodes = template.ownerDocument.createNodeIterator(template.content, view.NodeFilter.SHOW_ALL);

    let node;
    while ((node = nodes.nextNode())) {
        if (node instanceof view.Text && node.nodeValue) {
            const { firstSlot, strings } = findStringSlots(template[slotsKey], node.nodeValue);
            if (firstSlot < 0)
                continue;

            const fragment = template.ownerDocument.createDocumentFragment();

            fragment.append(strings[0]);
            for (const [i, s] of strings.slice(1).entries()) {
                const slot = template.ownerDocument.createElement('slot');
                const variableIndex = firstSlot + i;
                slot.name = variableIndex.toString();
                fragment.append(slot, s);

                template[elementsKey].push({
                    query: `slot[name="${variableIndex}"]`,
                    variableIndex
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
            const matchIndex = template[slotsKey].indices[attributeName];
            if (matchIndex != null) {
                // TODO
            } else
                console.assert(!template[slotsKey].regexp.exec(attributeName), 'partial expression in attribute position is illegal');

            const { firstSlot, strings } = findStringSlots(template[slotsKey], attribute.value);
            if (firstSlot < 0)
                continue;

            const stringsHead = strings[0];
            const stringsTail = Object.freeze(strings.slice(1));
            template[attributesKey].push({
                query: `[${attributeName}="${attribute.value}"]`,
                updateVariables: (element: Element) => {
                    const e = element;
                    return (values: unknown[]) => {
                        let a = stringsHead;
                        let s = firstSlot;
                        for (const string of stringsTail) {
                            a += values[s++] + string;
                        }
                        e.setAttribute(attributeName, a);
                    };
                }
            });
        }
    }
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
        name = slotInfo.names[++slot];
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
    #slotMarkers: Comment[];
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

        this.#slotMarkers = []
        const patchSlots = template[elementsKey].map(wire => {
            const slot = fragment.querySelector(wire.query);
            const marker = template.ownerDocument.createComment(`slot-${wire.variableIndex}`) as Containing<Comment>;
            slot?.replaceWith(marker);
            this.#slotMarkers.push(marker);

            marker[contentKey] = new ElementContent();

            return (values: unknown[]) => render(
                Placement.Element,
                values[wire.variableIndex],
                () => marker[contentKey],
                content => {
                    if (content === marker[contentKey])
                        return;
                    marker[contentKey].move();
                    marker[contentKey] = content;
                    marker.parentNode?.insertBefore(marker[contentKey].move(), marker.nextSibling);
                });
        });

        const patchAttributes = template[attributesKey].map(wire => {
            const element = fragment.querySelector(wire.query);
            if (!element) throw ''; // TODO
            return wire.updateVariables(element);
        });

        this.#patches = patchSlots.concat(patchAttributes);

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
