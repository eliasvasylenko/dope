# dope

An extremely lightweight HTML templating library which uses the platform to the fullest possible extent.

Write templates declaratively in plain HTML using javascript template literals.

    html`<span>Hello there.</span>`

Declare slots using placeholders populated by javascript expressions.

    function greet(name) { return html`<span>Hello there, ${name}.</span>` }

Compose templates trivially.

    function welcome(name, destination) {
        return html`
            ${greet(name)}
            <span>Welcome to ${destination}!</span>
        `;
    }

Templates may transparently define custom elements, with zero boilerplate and no manual class registration.

    function welcome(name) {
        return component`
            <welcome-mat
                    ${{destination: 10}}
                    onAttach=${() => this.destination = getDestination())}
	            onDetach=${() => this.blarg()}>
                ${welcome(name, c.destination)}
            </welcome-mat>
        `;
    }

Minimal, targeted DOM updates.
No virtual DOM, and no diff heuristics.
Uses the platform, no custom HTML parsing.
