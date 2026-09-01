package ai.deepseek.harness.remote

/** A stable Android release version accepted from the GitHub Release tag. */
data class ReleaseVersion(
    val major: Int,
    val minor: Int,
    val patch: Int,
) : Comparable<ReleaseVersion> {
    override fun compareTo(other: ReleaseVersion): Int = compareValuesBy(
        this,
        other,
        ReleaseVersion::major,
        ReleaseVersion::minor,
        ReleaseVersion::patch,
    )

    override fun toString(): String = "$major.$minor.$patch"

    companion object {
        private val stableTag = Regex("^android-v(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$")

        /** Parse the dedicated, stable Android Release tag; previews never match. */
        fun parseStableTag(tag: String): ReleaseVersion? {
            val match = stableTag.matchEntire(tag) ?: return null
            return ReleaseVersion(
                major = match.groupValues[1].toIntOrNull() ?: return null,
                minor = match.groupValues[2].toIntOrNull() ?: return null,
                patch = match.groupValues[3].toIntOrNull() ?: return null,
            )
        }
    }
}
