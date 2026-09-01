package ai.deepseek.harness.remote

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ReleaseVersionTest {
    @Test
    fun `parses dedicated stable Android tags`() {
        assertEquals(ReleaseVersion(0, 1, 0), ReleaseVersion.parseStableTag("android-v0.1.0"))
        assertEquals(ReleaseVersion(12, 34, 56), ReleaseVersion.parseStableTag("android-v12.34.56"))
    }

    @Test
    fun `rejects previews ambiguous tags and noncanonical numbers`() {
        assertNull(ReleaseVersion.parseStableTag("android-v1.2.3-rc.1"))
        assertNull(ReleaseVersion.parseStableTag("dsh-v1.2.3"))
        assertNull(ReleaseVersion.parseStableTag("v1.2.3"))
        assertNull(ReleaseVersion.parseStableTag("android-v01.2.3"))
    }

    @Test
    fun `compares every semantic version part`() {
        assertTrue(ReleaseVersion(1, 0, 0) > ReleaseVersion(0, 99, 99))
        assertTrue(ReleaseVersion(1, 3, 0) > ReleaseVersion(1, 2, 99))
        assertTrue(ReleaseVersion(1, 2, 4) > ReleaseVersion(1, 2, 3))
    }
}
