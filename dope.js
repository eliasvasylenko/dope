export function html(templateStrings, ...values) {
    const template = templateCache(templateStrings);
    return new HTMLPatcher(template, values);
}
export function shadow(templateStrings, ...values) {
    const template = templateCache(templateStrings);
    return new ShadowPatcher(template, values);
}
export function component(templateStrings, ...values) {
    const template = componentCache(templateStrings);
    return new ComponentPatcher(template, values);
}
export function patcher(value) {
    if (value instanceof Patcher)
        return value;
    else if (Array.isArray(value))
        return new ArrayPatcher(value);
    else if (value == null)
        return nullPatcher;
    else
        return new TextPatcher(value.toString());
}
export function keyed(key) {
    const keyedWrapper = f => (...args) => {
        const patcher = f(...args)
        patcher.key = key;
        return patcher;
    };
    return {
        html: keyedWrapper(html),
        shadow: keyedWrapper(shadow),
        patcher: keyedWrapper(patcher)
    }
}
export function target(element) {
    const e = element;
    return {
        render: patcher => {
            const content = render(e.content, e.appendChild.bind(e), patcher);
            e.content = content;
        },
        clear: () => {
            if (content != null)
                content.clear();
            delete e.content;
        }
    }
}

class Content {
    constructor(patcherConstructor) {
        this.patcherConstructor = patcherConstructor;
    }

    elements() { return []; }

    erase() {
        this.elements().forEach(e => e.remove());
    }

    move() {
        const fragment = document.createDocumentFragment();
        fragment.append(...this.elements());
        return fragment;
    }
}
class Patcher {
    init() {
        return new Content(this.constructor);
    }

    canPatch(content) {
        return content.patcherConstructor === this.constructor;
    }

    patch() { }
}

function render(content, insert, patcher) {
    if (content == null)
        return init(insert, patcher);

    if (patcher.canPatch(content)) {
        patcher.patch(content);
        return content;
    }

    content.erase();
    return init(insert, patcher);
}
function init(insert, patcher) {
    const content = patcher.init();
    patcher.patch(content);
    insert(content.move());
    return content;
}

const nullPatcher = new Patcher();

function makeCache(populate) {
    let cache = new WeakMap;
    return (...keys) => {
        let element = cache.get(keys);
        if (!element) {
            element = populate(...keys);
            cache.set(keys, element);
        }
        return element;
    }
}

// This function should only be called once for each
// string template as it is initialized. The cost is
// amortized over the lifetime of the template so we
// also front-load as much computation as we can.
//
// We parse the DOM using functionality built into the
// platform rather than burdening ourselves with the
// technical debt of a custom implementation.
const templateCache = makeCache(composeTemplate);
function composeTemplate(templateStrings) {
    const slotInfo = nameSlots(templateStrings);

    let templateString = templateStrings[0];
    let i = 0;
    templateStrings.slice(1).forEach(string => {
        templateString += slotInfo.names[i++] + string;
    });

    const template = document.createElement('template');
    template.innerHTML = templateString;
    template.slotInfo = slotInfo;
    wireSlots(template);

    return template;
}

// Find an appropriate list of slot names. We must
// avoid collision with legitimate text content. We do
// this by starting each name with a sequence of '{'
// longer than any contained in the template string.
const slotInfoCache = makeCache((prefix, postfix) => {
    let regexp = RegExp(prefix + '([0-9]*)' + postfix, 'm');
    return { regexp, names: [], indices: {} };
});
function nameSlots(templateStrings) {
    const prefix = '{' + templateStrings
        .flatMap(string => string.match(/{*/g)) // TODO make aware of &; encoding of '{'
        .reduce((a, b) => (a.length > b.length) ? a : b, '');
    const postfix = '}';
    const count = templateStrings.length - 1;

    let slotInfo = slotInfoCache(prefix, postfix);
    for (let i = slotInfo.names.length; i < count; i++) {
        const name = prefix + i + postfix;
        slotInfo.names.push(name);
        slotInfo.indices[name] = i;
    }
    return slotInfo;
}

function wireSlots(template) {
    template.attributeWires = [];
    template.slotWires = [];

    const nodes = document.createNodeIterator(template.content, NodeFilter.SHOW_ALL);

    let node;
    while (node = nodes.nextNode()) {
        if (node instanceof Text) {
            const { firstSlot, strings } = findStringSlots(template.slotInfo, node.nodeValue);
            if (firstSlot < 0)
                continue;

            const fragment = document.createDocumentFragment();

            fragment.append(strings[0]);
            strings.slice(1).forEach((s, i) => {
                const slot = document.createElement('slot');
                slot.name = firstSlot + i;
                fragment.append(slot, s);

                template.slotWires.push({
                    query: `slot[name="${slot.name}"]`,
                    variableIndex: slot.name
                });
            });

            node.parentNode.insertBefore(fragment, node);
            node.remove();

            continue;
        }

        const attributes = node.attributes;
        for (let a = 0; a < attributes?.length; a++) {
            const attribute = attributes[a];
            if (!attribute.specified)
                continue;

            const attributeName = attribute.name;
            let matchIndex = template.slotInfo.indices[attributeName];
            if (matchIndex != null) {

            } else
                console.assert(!template.slotInfo.regexp.exec(attributeName), 'partial expression in attribute position is illegal');

            const { firstSlot, strings } = findStringSlots(template.slotInfo, attribute.value);
            if (firstSlot < 0)
                continue;

            const stringsHead = strings[0];
            const stringsTail = Object.freeze(strings.slice(1));
            template.attributeWires.push({
                query: `[${attributeName}="${attribute.value}"]`,
                updateVariables: element => values => {
                    let a = stringsHead;
                    let s = firstSlot;
                    stringsTail.forEach(string => {
                        a += values[s++] + string;
                    });
                    element.setAttribute(attributeName, a);
                }
            });
        }
    }
}

function findStringSlots(slotInfo, string) {
    let match = slotInfo.regexp.exec(string);
    if (match == null)
        return { firstSlot: -1 };

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

class HTMLContent extends Content {
    constructor(patcherConstructor, template) {
        super(patcherConstructor);
        this.template = template;

        this.beginMarker = document.createComment('html-begin');
        this.endMarker = document.createComment('html-end');

        const fragment = document.createDocumentFragment();
        fragment.append(
            this.beginMarker,
            template.content.cloneNode(true),
            this.endMarker);
        this.elements = () => {
            const e = [];
            let n = this.beginMarker;
            do {
                e.push(n);
                n = n.nextSibling;
            } while (n !== this.endMarker);
            e.push(this.endMarker);
            return e;
        };

        this.slotMarkers = []
        const patchSlots = template.slotWires.map(wire => {
            const slot = fragment.querySelector(wire.query);
            const marker = document.createComment(`slot-${wire.variableIndex}`);
            slot.replaceWith(marker);
            this.slotMarkers.push(marker);

            marker.content = nullPatcher.init();

            return values => {
                const p = patcher(values[wire.variableIndex]);

                if (p.canPatch(marker.content)) {
                    p.patch(marker.content);

                } else {
                    marker.content.erase();
                    marker.content = p.init();
                    p.patch(marker.content);
                    marker.parentNode.insertBefore(marker.content.move(), marker.nextSibling);
                }
            };
        });

        const patchAttributes = template.attributeWires.map(wire => {
            const element = fragment.querySelector(wire.query);
            return wire.updateVariables(element);
        });

        this.patches = patchSlots.concat(patchAttributes);
    }
}
class HTMLPatcher extends Patcher {
    constructor(template, values) {
        super();
        this.template = template;
        this.values = values;
    }

    init() {
        return new HTMLContent(this.constructor, this.template);
    }

    canPatch(content) {
        return super.canPatch(content) && (content.template === this.template);
    }

    patch(content) {
        content.patches.forEach(patch => patch(this.values));
    }
}

class TextContent extends Content {
    constructor(patcherConstructor) {
        super(patcherConstructor);
        this.node = document.createTextNode('');
    }

    elements() { return [this.node]; }
}
class TextPatcher extends Patcher {
    constructor(text) {
        super();
        this.text = text;
    }

    init() {
        return new TextContent(this.constructor);
    }

    patch(content) {
        content.node.nodeValue = this.text;
    }
}

class ArrayContent extends Content {
    constructor(patcherConstructor) {
        super(patcherConstructor);

        this.marker = document.createComment('array');
        this.keys = [];
        this.contents = {};

        const fragment = document.createDocumentFragment();
        fragment.appendChild(this.marker);
    }

    elements() {
        return [
            this.marker,
            ...this.keys.map(k => this.contents[k]).flatMap(e => e.elements())
        ];
    }
}
class ArrayPatcher extends Patcher {
    constructor(values) {
        super();
        this.patchers = values.map(patcher);
    }

    init() {
        return new ArrayContent(this.constructor);
    }

    patch(content) {
        const parent = content.marker.parentNode;
        let next = content.marker.nextSibling;
        const insert = element => parent.insertBefore(element, next);

        const keys = [];
        const contents = {};

        let sourceIndex = 0;
        let index = 0;
        this.patchers.forEach(patcher => {
            let key = (patcher.key)
                ? 'key-' + patcher.key
                : 'index-' + index++;
            keys.push(key);

            let value = content.contents[key];
            if (value) {
                if (patcher.canPatch(value)) {
                    patcher.patch(value);

                    delete content.contents[key];

                    sourceIndex = (sourceIndex < 0)
                        ? sourceIndex
                        : content.keys.indexOf(key, sourceIndex) + 1;
                    if (sourceIndex < 0) {
                        insert(value.move());
                    } else {
                        const e = value.elements();
                        next = e[e.length - 1].nextSibling;
                    }
                } else {
                    value.erase();
                    value = patcher.init();
                    patcher.patch(value);
                }
            } else {
                value = patcher.init();
                patcher.patch(value);

                insert(value.move());
            }
            contents[key] = value;
        });

        Object.values(content.contents).forEach(v => v.erase());

        content.keys = keys;
        content.contents = contents;
    }
}
