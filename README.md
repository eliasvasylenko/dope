# dope

An extremely lightweight HTML templating library which uses the platform to the fullest possible extent.

Write templates declaratively in plain HTML using javascript template literals.

```js
html`<span>Hello there.</span>`
```

Declare slots using placeholders, which are filled by javascript expressions.

```js
let greet = (name) =>
  html`<span>Hello there, ${name}.</span>`;
```

Templates compose trivially.

```js
let welcome = (name, destination) =>
  html`
    ${greet(name)}
    <span>Welcome to ${destination}!</span>
  `;
```

Templates may transparently define custom elements, with zero boilerplate.

This is and no manual class registration.

```js
let welcomeMat = (name) =>
  component`
    <welcome-mat
        ${{
          name,
          destination: getInitialDestination()
        }}
        onChangeOf=${[ 'name', 'destination' ]}
        onDetach=${() => console.log(`Goodbye, ${this.name}`)}>
      ${() => welcome(this.name, this.destination)}
    </welcome-mat>
  `;
```

```js
let welcomeMat = (name) =>
  component`
    <welcome-mat
        ${class {
	  name = name;
	  destination = getInitialDestination();
          onDetach() { console.log(`Goodbye, ${name}`); }
        }}>
      ${() => welcome(this.name, this.destination)}
    </welcome-mat>
  `;
```

Minimal, targeted DOM updates.
No virtual DOM, and no diff heuristics.
Uses the platform, no custom HTML parsing.
