/** An error whose message is safe to show to the user, with the HTTP status to return. */
export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
