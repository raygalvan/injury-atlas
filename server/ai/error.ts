/** Only deliberately public messages may cross the API boundary. */
export class AiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "AiError";
  }
}
