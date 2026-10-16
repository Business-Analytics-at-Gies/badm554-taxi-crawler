class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const refuse = (status, code, message) => { throw new HttpError(status, code, message); };
module.exports = { HttpError, refuse };
