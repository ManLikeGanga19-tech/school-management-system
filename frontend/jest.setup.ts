import "@testing-library/jest-dom";
// Polyfill the Fetch API (Response, Headers, Request, fetch) for the jsdom
// test environment. jsdom 26 does not ship fetch; whatwg-fetch is the
// standard polyfill recommended by the Jest team for this case.
import "whatwg-fetch";
