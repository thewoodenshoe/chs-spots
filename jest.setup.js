// Learn more: https://github.com/testing-library/jest-dom
require('@testing-library/jest-dom');

process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY || 'test-api-key';

// Mock global Request/Response for Next.js API routes (Node.js environment)
if (typeof global.Request === 'undefined') {
  global.Request = class Request {
    constructor(input, init) {
      this.input = input;
      this.init = init;
    }
  };
}

if (typeof global.Response === 'undefined') {
  global.Response = class Response {
    constructor(body, init) {
      this.body = body;
      this.init = init;
    }
  };
}