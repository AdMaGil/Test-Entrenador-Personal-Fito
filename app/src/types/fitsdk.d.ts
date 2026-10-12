declare module "@garmin/fitsdk" {
  export class Stream {
    static fromArrayBuffer(buf: ArrayBuffer): Stream;
  }
  export class Decoder {
    constructor(stream: Stream);
    isFIT(): boolean;
    checkIntegrity(): boolean;
    read(opts?: Record<string, unknown>): {
      messages: Record<string, Array<Record<string, unknown>>>;
      errors: unknown[];
    };
  }
}
