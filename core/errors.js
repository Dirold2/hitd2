"use strict";export class TrackNotFoundError extends Error{trackId;host;status;constructor(r,o=404,t){super(`Track ${r} was not found${t?` on ${t}`:""} (HTTP ${o})`),this.name="TrackNotFoundError",this.trackId=r,this.host=t,this.status=o,Object.setPrototypeOf(this,new.target.prototype)}}
//# sourceMappingURL=errors.js.map
