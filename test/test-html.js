import 'mocha';
import { JSDOM } from 'jsdom';

describe("Initialize HTML", function () {
    let dom;
    before(async function () {
        dom = await JSDOM.fromFile("index.html", {
            resources: "usable",
            runScripts: "dangerously"
        });
        await new Promise(resolve =>
            dom.window.addEventListener("load", resolve)
        );
    });

    it('updates the innerHTML of element with id "msg"', function () {
        expect(dom.window.document.getElementById("msg").innerHTML).to.equal(
            "Hello, World!"
        );
        dom.window.updateMsg("The new msg!");
        expect(dom.window.document.getElementById("msg").innerHTML).to.equal(
            "The new msg!"
        );
    });
});