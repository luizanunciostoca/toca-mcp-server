package br.com.tocadomorcego.tocaos.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val TocaDarkColors = darkColorScheme(
    primary = Color(0xFFFFC629),
    onPrimary = Color(0xFF16120A),
    secondary = Color(0xFF8A2BE2),
    background = Color(0xFF0D0D0D),
    surface = Color(0xFF151515),
    surfaceVariant = Color(0xFF202020),
    onBackground = Color(0xFFF7F7F7),
    onSurface = Color(0xFFF7F7F7),
    onSurfaceVariant = Color(0xFFBDBDBD),
)

@Composable
fun TocaTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = TocaDarkColors, content = content)
}
