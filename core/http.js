"use strict";import{HyperClient as t}from"hyperttp";import{DEFAULT_HTTP_CONFIG as s}from"./config.js";export class HttpClient{client;constructor(e){this.client=e??new t(s)}async getText(e){return this.client.get(e.url,{headers:e.headers,responseType:"text"})}async getJson(e){return this.client.get(e.url,{headers:e.headers,responseType:"json"})}}
//# sourceMappingURL=http.js.map
