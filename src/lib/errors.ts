/** An error whose message is written for the person using the app and is safe to display. */
export class UserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserError";
  }
}
