/** Immutable paths used by Electron distribution packaging. */
export interface DistributionPaths {
  appRoot: string
  builderConfig: string
  output: string
  rootPackageJson: string
}

/** Return the fixed paths that an Electron distribution build may use. */
export function distributionPaths(): DistributionPaths

/** Reject an output path that escapes the Electron app directory. */
export function assertAppOutputPath(appRoot: string, output: string): void

/** Hash a source file so a packaging subprocess cannot silently overwrite it. */
export function fingerprintFile(file: string): string

/** Assert that a source file has exactly the expected pre-build bytes. */
export function assertFileUnchanged(file: string, expectedHash: string): void
