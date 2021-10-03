import { testcase, subcase } from '@strangeskies/ducktest';
import { JSDOM } from 'jsdom';
import { strict as assert } from 'assert';
import { target, keyed } from '../dist/dope.js';
import { html } from '../dist/dope-html.js';
testcase('begin with an empty document', async () => {
    const dom = new JSDOM(`
        <!DOCTYPE html>
        <html lang="en">
        
        <head>
            <title>Test</title>
            <meta charset="utf-8">
        </head>

        <body>blarg</body>

        </html>
    `);
    const window = dom.window;
    await new Promise(resolve => window.onload = resolve);
    const document = window.document;
    document.body.textContent = '';
    const bodyTarget = target(document.body);
    subcase('render a span as plain HTML', () => {
        const action = html `<span id="test">test</span>`;
        bodyTarget.render(action);
        const span = document.querySelector('[id="test"]');
        assert.ok(span, 'the span rendered into the document');
        assert.equal(span.textContent, 'test', 'span contains expected text');
        subcase('rerender the same action', () => {
            bodyTarget.render(action);
            const newSpan = document.querySelector('[id="test"]');
            assert.equal(span, newSpan, 'reuses the original span');
        });
    });
    subcase('render an array embedded in HTML', () => {
        bodyTarget.render(html `<span id="test">${['first', 'second']}</span>`);
        const span = document.querySelector('[id="test"]');
        assert.equal(span?.textContent, 'firstsecond', 'span contains expected text');
    });
    subcase('render an array of HTML fragments', () => {
        const div = (i) => html `<div id="test${i}">${i}</div>`;
        let array;
        const action = () => array;
        array = [keyed(0, div(0)), keyed(1, div(1)), div(2), div(3), keyed(4, div(4)), keyed(5, div(5))];
        bodyTarget.render(action);
        const divs = [];
        for (let i = 0; i < 6; i++) {
            divs.push(document.querySelector(`[id="test${i}"]`));
        }
        assert.equal(document.body.textContent, '012345', 'body contains expected text');
        subcase('render the same HTML fragments, but reordered', () => {
            array = [div(2), keyed(1, div(1)), keyed(0, div(0)), keyed(5, div(5)), div(3), keyed(4, div(4))];
            bodyTarget.render(action);
            for (let i = 0; i < 6; i++) {
                assert.equal(document.querySelector(`[id="test${i}"]`), divs[i], `updated div ${i}`);
            }
            assert.equal(document.body.textContent, '210534', 'body contains expected text');
        });
    });
    window.close();
});
//# sourceMappingURL=test-html.js.map