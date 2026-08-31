/**
 * qaKey.ts — access-key guard for the "/qa" Excel QA window.
 *
 * Every QA request (POST /api/qa and POST /api/qa/ai-fix) must carry a valid
 * `key` form field. The expected value is read from the QA_KEY environment
 * variable so it can be rotated without touching code. For local testing the
 * default is TEST_KEY below ("1234") — replace it (or set QA_KEY in the
 * environment / .env.local) once you have a real key.
 */

/** Default access key used for testing until a real one is configured. */
const TEST_KEY = "1234";

/** The access key QA requests must present (env override > test default). */
export function qaKey(): string {
  const fromEnv = process.env.QA_KEY;
  return fromEnv && fromEnv.trim() !== "" ? fromEnv.trim() : TEST_KEY;
}

/** Validate the `key` field a QA client submitted (e.g. formData.get("key")). */
export function isValidQaKey(
  submitted: FormDataEntryValue | string | null | undefined
): boolean {
  const expected = qaKey();
  if (!expected) return false; // no key configured → nothing can validate
  return (
    typeof submitted === "string" &&
    submitted.trim() !== "" &&
    submitted.trim() === expected
  );
}