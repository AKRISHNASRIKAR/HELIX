import { ParseUUIDPipe } from '@nestjs/common';

/** Path ids are UUIDs everywhere; a malformed one is a 400, not a DB error. */
export const UuidPipe = new ParseUUIDPipe();
