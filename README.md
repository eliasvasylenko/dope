# dope

An extremely lightweight HTML templating library which uses the platform to the fullest possible extent.

Write templates declaratively in plain HTML using javascript template literals.

```js
html`<span>Hello there.</span>`
```

Declare slots using placeholders, which are filled by javascript expressions.

```js
let greet = (name) => html`<span>Hello there, ${name}.</span>`;
```

Templates compose trivially, simple pass a template into a slot.

```js
let welcome = (name, destination) =>
  html`
    ${greet(name)}
    <span>Welcome to ${destination}!</span>
  `;
```

Templates may transparently define custom elements, with near-zero boilerplate and no manual class registration.

```js
let welcomeAnywhere = (name) =>
  let setDestination = (destination) => {
    instance().destination = destination;
    instance().updateDestination.forEach(call);
  };
  let getDestination = () => {
    (instance().updateDestination ||= new Set()).add(runner().repeat); 
    return instance().destination;
  };
  component`
    <welcome-somewhere ${{ destination: defaultDestination() }}>
      ${() => welcome(name, getDestination())}
      <button @click=${() => setDestination(randomDestination())}>
    </welcome-somewhere>
  `;
```

```js
let welcomeAnywhere = (name) =>
  component`
    <welcome-somewhere ${{ destination: defaultDestination() }}>
      ${() => welcome(name, ctx.destination)}
      <button @click=${() => ctx.destination = randomDestination()}>
    </welcome-somewhere>
  `;
```

```js
let welcomeAnywhere = (name) => {
  let welcomeCtx = ctx`welcome`({ destination: defaultDestination() });
  return component`
    <welcome-somewhere ${welcomeCtx}>
      ${() => welcome(name, welcomeCtx.destination)}
      <button @click=${() => welcomeCtx.destination = nextDestination()}>
    </welcome-somewhere>
  `;
};
```

```js
let welcomeAnywhere = (name) => {
  let welcomeCtx = ctx`welcome`({ destination: defaultDestination() });
  return component()`
    <welcome-somewhere>
      ${() => welcome(name, welcomeCtx.destination)}
      <button
          ${{
            click: () => welcomeCtx.destination = nextDestination()
          }}>
    </welcome-somewhere>
  `;
};
```

```js
function friendHook(friend) {
  let friendState = state`friend`({ online: null });

  let friendEffect = () => {
    let handleStatusChange = status =>
      friendState.online = status.isOnline;

    ChatAPI.subscribeToFriendStatus(friend.id, handleStatusChange);
    action().onUndo = () => {
      ChatAPI.unsubscribeFromFriendStatus(friend.id, handleStatusChange);
    };
  };

  return component`
    <friend-status ${[ friendState, friendEffect ]}>
      <h1>${friend.name}</h1>
      ${() => statusText(friendState.online)}
    </friend-status>
  `;
}
```

```js
function FriendStatus(friend) {
  let friendKey = sym`friend-state`;
  return component`
    <friend-status ${friendHook(friend)}>
      <h1>${friend.name}</h1>
      ${() => statusText(elem.friendOnline)}
    </friend-status>
  `;
}
```

```js
function App() {
  const myResult = useAsync(myFunction, false);

  return () => html`
    <div>
      <div>
        ${
          myResult.value ||
          myResult.error ||
          "Start your journey by clicking a button"
        }
      </div>
      <button @click=${myResult.execute} disabled=${myResult.pending}>
        ${myResult.pending ? "Loading..." : "Click me"}
      </button>
    </div>
  `;
}
```

```js
const friendKey = Symbol('friendState');
function friendHook(friend) {
  return [
    { [friendKey]: { online: null } },
    () => {
      let handleStatusChange = status =>
        state().friendOnline = status.isOnline;
      ChatAPI.subscribeToFriendStatus(
        friend.id,
        handleStatusChange);
      return () => {
        ChatAPI.unsubscribeFromFriendStatus(
          friend.id,
          handleStatusChange);
      };
    }
  ];
}
function friendState() {
  return element()[friendKey];
}

function FriendStatus(friend) {
  return component`
    <friend-status ${friendHook(friend)}>
      <h1>${friend.name}</h1>
      ${() => statusText(friendState().online)}
    </friend-status>
  `;
}
```

Minimal, targeted DOM updates.
No virtual DOM, and no diff heuristics.
Uses the platform, no custom HTML parsing.
