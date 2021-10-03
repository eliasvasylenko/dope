export enum Placement {
    Element = 'element',
    Attribute = 'attribute',
    Tag = 'tag'
}
export type Action = () => unknown;
type ActionFactory = (value: unknown) => Action | void;
const actionFactories: Record<Placement, ActionFactory[]> = {
    [Placement.Element]: [makeTextAction, makeArrayAction],
    [Placement.Attribute]: [makeStringAction, makeJoinAction],
    [Placement.Tag]: [makePropertiesAction]
};

export function defineAction(placement: Placement, action: ActionFactory): void {
    const f = actionFactories[placement];
    console.assert(f, `Invalid placement for definition ${String(placement)}`);
    f.push(action)
}
export function toAction(placement: Placement, value: unknown): Action {
    const f = actionFactories[placement];
    console.assert(f, `Invalid placement for conversion ${String(placement)}`);

    if (value instanceof Function)
        return value as Action;

    for (let i = f.length - 1; i >= 0; i--) {
        const a = f[i](value);
        if (a != null) {
            return a;
        }
    }
    throw new Error(`Failed to convert argument ${value} to action for ${placement}.`);
}

type PlacementContent<P extends Placement> =
    P extends Placement.Element ? ElementContent :
    P extends Placement.Attribute ? AttributeContent :
    P extends Placement.Tag ? TagContent :
    Content;
interface CurrentPlace<P extends Placement = Placement> {
    document: Document;
    placement: Placement;
    parentContent?: P | ElementContent;
    priorContent: PlacementContent<P>;
    update: (content: PlacementContent<P>) => void;
}
interface CurrentAction {
    onUndo(action: Action): void;
    repeat(): void;
}
const contentKey = Symbol('content');
const placeKey = Symbol('place');
type AugmentedElement = Element & {
    [contentKey]?: ElementContent;
    [placeKey]?: CurrentPlace<Placement.Element>;
}

export interface Target {
    render(action: unknown): void;
    clear(): void;
}

// Prepare the given element as a target for rendering an action.
export function target(element: AugmentedElement): Target {
    const e = element;
    return {
        render(action) {
            e[contentKey] = e[contentKey] || new ElementContent();
            const place: CurrentPlace<Placement.Element> = {
                document: e.ownerDocument,
                placement: Placement.Element,
                get priorContent() { return e[contentKey] as ElementContent; },
                update: (content: ElementContent) => {
                    if (content === e[contentKey])
                        return;
                    const fragment = e[contentKey]?.move();
                    e[contentKey] = content;
                    if (fragment) e.appendChild(content.move());
                }
            };
            e[placeKey] = e[placeKey] || place;
            renderInPlace(place, action);
        },
        clear() {
            e[placeKey]?.priorContent.move();
            delete e[contentKey];
            delete e[placeKey];
        }
    };
}

// Returns an interface to the place of evaluation of
// the action which is currently evaluating.
export function place(): CurrentPlace { return _place; }
let _place: CurrentPlace;

// Returns an interface to the action which is currently
// evaluating.
export function action(): CurrentAction { return _action; }
let _action: CurrentAction;

type Content = ElementContent | AttributeContent | TagContent;
export class ElementContent {
    nodes(): Node[] { return []; }
    move(): DocumentFragment {
        const fragment = place().document.createDocumentFragment();
        fragment.append(...this.nodes());
        return fragment;
    }
}
export class AttributeContent {
    value(): string { return ''; }
}
export class TagContent {
    attributes(): Record<string, string> { return {}; }
    properties(): Record<string, unknown> { return {}; }
}

function renderInPlace(place: CurrentPlace, action: unknown) {
    const parentPlace = _place;
    const parentAction = _action;

    const p = place;
    _place = p;
    while (!(action instanceof ElementContent || action instanceof AttributeContent || action instanceof TagContent)) {
        const a = toAction(Placement.Element, action);
        _action = {
            onUndo() { /* TODO */ },
            repeat() { renderInPlace(p, a); }
        };
        action = a();
        _action.onUndo = () => { /* TODO do something with _action.onUndo */ };
    }

    _place.update(action);

    _action = parentAction;
    _place = parentPlace;
}
export function render<P extends Placement>(placement: P, action: unknown, priorContent: () => PlacementContent<P>, updateContent: (content: PlacementContent<P>) => void): void {
    const prior = priorContent;
    const place = {
        placement,
        document: _place.document,
        parentContent: _place.priorContent,
        get priorContent() { return prior() },
        update: updateContent
    } as CurrentPlace<P>;
    renderInPlace(place, action);
}

class TextContent extends ElementContent {
    #node: Node;

    constructor(text: string) {
        super();
        this.#node = place().document.createTextNode(text);
    }

    patch(text: string) { this.#node.nodeValue = text; }
    nodes() { return [this.#node]; }
}
function makeTextAction(value: unknown) {
    if (value == null)
        value = '';
    if (typeof value === 'number')
        value = value.toString();
    if (typeof value !== "string")
        return;

    const s = value;

    return () => {
        const content = place().priorContent;
        if (content instanceof TextContent) {
            content.patch(s);
            return content;
        } else {
            return new TextContent(s);
        }
    }
}

const keySym = Symbol('key');
type Keyed<T> = T & {
    [keySym]?: unknown;
};

export function keyed<T>(key: unknown, action: T): () => T {
    const k = key;
    const a = action;
    return () => {
        const keyedPlace: Keyed<CurrentPlace> = _place;
        keyedPlace[keySym] = k;
        return a;
    };
}
export function key(): unknown {
    const keyedPlace: Keyed<CurrentPlace> = _place;
    return keyedPlace[keySym];
}

class ArrayContent extends ElementContent {
    #marker: Comment;
    #contents: ElementContent[];
    #contentsByKey: Record<string, ElementContent>;

    constructor(actions: Action[]) {
        super();

        this.#marker = place().document.createComment('array');
        this.#contents = [];
        this.#contentsByKey = {};

        const fragment = place().document.createDocumentFragment();
        fragment.appendChild(this.#marker);

        this.patch(actions);
    }

    nodes() {
        return [
            this.#marker,
            ...this.#contents.flatMap(e => e.nodes())
        ];
    }

    patch(actions: Action[]) {
        const parent = this.#marker.parentNode;
        let next = this.#marker.nextSibling;
        const insert = (node: Node) => {
            parent?.insertBefore(node, next);
        }

        const contents: ElementContent[] = [];
        const contentsByKey: Record<string, ElementContent> = {};

        const indicesByContent = new Map();
        for (const [i, content] of this.#contents.entries()) {
            indicesByContent.set(content, i);
        }

        let updatedInPlaceIndex = -1;
        let index = 0;
        for (const action of actions) {
            let _key: string;
            const getKey = () => _key = _key || (key() != null)
                ? 'key-' + key()
                : 'index-' + index++;

            const priorContent = () =>
                this.#contentsByKey[getKey()] || undefined;

            const updateContent = (content: ElementContent) => {
                const matchIndex = indicesByContent.get(content);
                indicesByContent.delete(content);

                if (matchIndex > updatedInPlaceIndex) {
                    updatedInPlaceIndex = matchIndex;

                    const e = content.nodes();
                    next = e[e.length - 1].nextSibling;
                } else {
                    insert(content.move());
                }

                contents.push(content);
                contentsByKey[getKey()] = content;
            };

            render(Placement.Element, action, priorContent, updateContent);
        }

        for (const [content] of indicesByContent) {
            content.move();
        }

        this.#contents = contents;
        this.#contentsByKey = contentsByKey;
    }
}
function makeArrayAction(values: unknown) {
    if (values == null)
        values = [];
    if (!Array.isArray(values))
        return;

    const actions = values.map(v => toAction(Placement.Element, v));

    return () => {
        const content = place().priorContent;
        if (content instanceof ArrayContent) {
            content.patch(actions);
            return content;
        } else {
            return new ArrayContent(actions);
        }
    }
}

class StringContent extends AttributeContent {
    #string: string;

    constructor(string: string) {
        super();
        this.#string = string;
    }
    value() { return this.#string; }
}
function makeStringAction(value: unknown) {
    if (value == null)
        value = '';
    if (typeof value === 'number')
        value = value.toString();
    if (typeof value !== 'string')
        return;

    const content = new StringContent(value);
    return () => content;
}

function makeJoinAction() {
    throw 'join action not implemented';
}

class PropertiesContent extends TagContent {
    #object: Record<string, unknown>;

    constructor(object: Record<string, unknown>) {
        super();
        this.#object = object;
    }

    properties() { return this.#object; }
}
function makePropertiesAction(value: unknown) {
    if (value == null)
        value = {};
    if (typeof value !== 'object')
        return;
    if (value === null)
        return;

    const content = new PropertiesContent(value as Record<string, unknown>);
    return () => content;
}
