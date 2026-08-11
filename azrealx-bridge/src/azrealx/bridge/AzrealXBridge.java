package azrealx.bridge;

import net.fabricmc.api.ClientModInitializer;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.List;

/**
 * AzrealX Bridge - applies launcher game options live while Minecraft runs.
 *
 * Watches {@code azrealx-live-options.json} in the game directory (the
 * current working directory) and, on a new {@code rev:} value, pushes each
 * option into the vanilla {@code OptionInstance}. Runs entirely on
 * reflection so it survives both 26.x (new field names, SoundSource map,
 * enum options) and legacy (1.21.x) mappings: every key first tries the
 * 26.x field, then the legacy field.
 */
public class AzrealXBridge implements ClientModInitializer {

    private static final long POLL_MS = 1250;
    private volatile long lastRev = Long.MIN_VALUE;

    /**
     * options.txt key -> preferred (26.x) field, fallback (legacy) field.
     */
    private static final String[][] KEY_FIELDS = {
            {"mouseSensitivity", "sensitivity", "mouseSensitivity"},
            {"maxFps", "framerateLimit", "maxFps"},
            {"ao", "ambientOcclusion", "ao"},
            {"invertXMouse", "invertMouseX", "invertXMouse"},
            {"invertYMouse", "invertMouseY", "invertYMouse"},
            {"graphicsMode", "graphicsPreset", "graphicsMode"},
            {"renderClouds", "cloudStatus", "renderClouds"},
    };

    @Override
    public void onInitializeClient() {
        Thread watcher = new Thread(this::watchLoop, "azrealx-bridge");
        watcher.setDaemon(true);
        watcher.start();
        System.out.println("[AzrealXBridge] live options bridge started (polling azrealx-live-options.json)");
    }

    private void watchLoop() {
        Path file = Paths.get("azrealx-live-options.json");
        while (true) {
            try {
                Thread.sleep(POLL_MS);
            } catch (InterruptedException e) {
                return;
            }
            try {
                if (!Files.exists(file)) {
                    continue;
                }
                String raw = new String(Files.readAllBytes(file), StandardCharsets.UTF_8);
                long rev = parseRev(raw);
                if (rev == Long.MIN_VALUE || rev == lastRev) {
                    continue;
                }
                lastRev = rev;
                List<String[]> entries = parseEntries(raw);
                if (entries.isEmpty()) {
                    continue;
                }
                System.out.println("[AzrealXBridge] applying " + entries.size() + " live options (rev " + rev + ")");
                pushToGame(entries);
            } catch (Throwable t) {
                System.out.println("[AzrealXBridge] poll error: " + rootCause(t));
            }
        }
    }

    private static long parseRev(String raw) {
        for (String line : raw.split("\n")) {
            if (line.startsWith("rev:")) {
                try {
                    return Long.parseLong(line.substring(4).trim());
                } catch (NumberFormatException ignored) {
                    return Long.MIN_VALUE;
                }
            }
        }
        return Long.MIN_VALUE;
    }

    /** each non-rev line: {@code key:type:value} with type in bool|int|double|string */
    private static List<String[]> parseEntries(String raw) {
        List<String[]> out = new ArrayList<>();
        for (String line : raw.split("\n")) {
            String l = line.trim();
            if (l.isEmpty() || l.startsWith("rev:")) {
                continue;
            }
            int c1 = l.indexOf(':');
            int c2 = l.indexOf(':', c1 + 1);
            if (c1 <= 0 || c2 <= c1 + 1) {
                continue;
            }
            out.add(new String[]{l.substring(0, c1), l.substring(c1 + 1, c2), l.substring(c2 + 1)});
        }
        return out;
    }

    private static void pushToGame(List<String[]> entries) {
        Object mc = reflectStatic("net.minecraft.client.Minecraft", "getInstance");
        if (mc == null) {
            System.out.println("[AzrealXBridge] Minecraft instance unavailable");
            return;
        }
        Method execute = findMethod(mc.getClass(), "execute");
        if (execute == null) {
            System.out.println("[AzrealXBridge] no execute() method found");
            return;
        }
        // dispatch on the render thread - vanilla options must not be
        // touched from a worker thread
        try {
            execute.invoke(mc, (Runnable) () -> applyOnRenderThread(mc, entries));
        } catch (Throwable t) {
            System.out.println("[AzrealXBridge] dispatch failed: " + rootCause(t));
        }
    }

    private static void applyOnRenderThread(Object mc, List<String[]> entries) {
        try {
            Object options = readField(mc, "options");
            if (options == null) {
                System.out.println("[AzrealXBridge] options field not found");
                return;
            }
            Class<?> optionCls = Class.forName("net.minecraft.client.OptionInstance");
            int applied = 0;
            int skipped = 0;
            for (String[] e : entries) {
                try {
                    if (isSoundKey(e[0])) {
                        if (applySoundOption(options, optionCls, e)) {
                            applied++;
                        } else {
                            skipped++;
                        }
                        continue;
                    }
                    Field f = resolveField(options, e[0]);
                    if (f == null) {
                        skipped++;
                        System.out.println("[AzrealXBridge] skip key=" + e[0] + " (no matching field)");
                        continue;
                    }
                    if (!optionCls.isAssignableFrom(f.getType())) {
                        skipped++;
                        continue;
                    }
                    Object instance = f.get(options);
                    // the declared field type is always OptionInstance; the
                    // value type lives in the generic argument (Integer,
                    // Double, Boolean, String, enum, ...)
                    Object parsed = parseForType(e[1], e[2], genericArgument(f));
                    if (parsed == null) {
                        skipped++;
                        System.out.println("[AzrealXBridge] skip key=" + e[0] + " (unparseable value '" + e[2] + "')");
                        continue;
                    }
                    Method set = optionCls.getMethod("set", Object.class);
                    try {
                        set.invoke(instance, parsed);
                    } catch (Throwable primary) {
                        // enum/cycle option expecting a String: retry verbatim
                        set.invoke(instance, e[2]);
                    }
                    applied++;
                } catch (Throwable t) {
                    skipped++;
                    System.out.println("[AzrealXBridge] key " + e[0] + " failed: " + rootCause(t));
                }
            }
            if (applied > 0) {
                trySave(options);
                refreshOpenOptionsScreen(mc);
                System.out.println("[AzrealXBridge] applied " + applied + " options, saved" + (skipped > 0 ? " (" + skipped + " skipped)" : ""));
            } else if (skipped > 0) {
                System.out.println("[AzrealXBridge] nothing applied (" + skipped + " skipped)");
            }
        } catch (Throwable t) {
            System.out.println("[AzrealXBridge] apply error: " + rootCause(t));
        }
    }

    // --- sound options -------------------------------------------------

    private static boolean isSoundKey(String key) {
        return key.startsWith("soundCategory.") || key.startsWith("soundCategory_");
    }

    private static String soundName(String key) {
        String s = key.startsWith("soundCategory_") ? key.substring("soundCategory_".length()) : key.substring("soundCategory.".length());
        int idx = s.indexOf('.');
        return idx >= 0 ? s.substring(0, idx) : s;
    }

    private static boolean applySoundOption(Object options, Class<?> optionCls, String[] e) throws Exception {
        String value = e[2];
        Object parsed = parseForType(e[1], value, Double.class);
        if (parsed == null) {
            parsed = parseForType(e[1], value, String.class);
        }
        String name = soundName(e[0]);

        // 26.x: SoundSource map via Options#getSoundSourceOptionInstance(SoundSource)
        try {
            Class<?> soundSource = Class.forName("net.minecraft.sounds.SoundSource");
            String unitName = name.toUpperCase();
            if (unitName.equals("RECORD")) {
                unitName = "RECORDS";
            }
            Object unit = Enum.valueOf((Class<Enum>) soundSource, unitName);
            Method get = options.getClass().getMethod("getSoundSourceOptionInstance", soundSource);
            Object instance = get.invoke(options, unit);
            Method set = optionCls.getMethod("set", Object.class);
            set.invoke(instance, parsed);
            return true;
        } catch (Throwable ignored) {
            // fall through to legacy fields
        }
        // legacy: soundCategoryVolumeMaster & co.
        Field f = resolveField(options, "soundCategoryVolume" + capitalize(name));
        if (f == null) {
            return false;
        }
        Object instance = f.get(options);
        Method set = optionCls.getMethod("set", Object.class);
        set.invoke(instance, parsed);
        return true;
    }

    // --- field resolution ---------------------------------------------

    private static Field resolveField(Object options, String key) {
        String preferred = key;
        String fallback = null;
        for (String[] pair : KEY_FIELDS) {
            if (pair[0].equals(key)) {
                preferred = pair[1];
                fallback = pair[2];
                break;
            }
        }
        Field f = findField(options.getClass(), preferred);
        if (f == null && fallback != null) {
            f = findField(options.getClass(), fallback);
        }
        return f;
    }

    private static Field findField(Class<?> cls, String name) {
        try {
            Field f = cls.getDeclaredField(name);
            f.setAccessible(true);
            return f;
        } catch (Throwable t) {
            return null;
        }
    }

    /** value type of an {@code OptionInstance<X>} field, or Object if unknown */
    private static Class<?> genericArgument(Field f) {
        java.lang.reflect.Type t = f.getGenericType();
        if (t instanceof java.lang.reflect.ParameterizedType pt) {
            java.lang.reflect.Type[] args = pt.getActualTypeArguments();
            if (args.length > 0 && args[0] instanceof Class<?> c) {
                return c;
            }
        }
        return Object.class;
    }

    // --- value parsing -------------------------------------------------

    private static Object parseForType(String type, String value, Class<?> fieldType) {
        // the launcher stores select/enum values quoted ("0", "fancy", ...)
        if (value.length() >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
            value = value.substring(1, value.length() - 1);
        }
        if (fieldType == Boolean.class || fieldType == Boolean.TYPE) {
            return Boolean.valueOf(value.equalsIgnoreCase("true") || value.equals("1"));
        }
        if (fieldType == Integer.class || fieldType == Integer.TYPE) {
            try {
                return Integer.valueOf((int) Math.round(Double.parseDouble(value)));
            } catch (NumberFormatException e) {
                return null;
            }
        }
        if (fieldType == Double.class || fieldType == Double.TYPE) {
            try {
                return Double.valueOf(value);
            } catch (NumberFormatException e) {
                return null;
            }
        }
        if (fieldType == String.class) {
            return value;
        }
        if (fieldType.isEnum()) {
            try {
                return Enum.valueOf((Class<Enum>) fieldType, value.toUpperCase().replace(' ', '_'));
            } catch (IllegalArgumentException e) {
                try {
                    int i = (int) Math.round(Double.parseDouble(value));
                    Enum<?>[] values = ((Class<Enum>) fieldType).getEnumConstants();
                    if (i >= 0 && i < values.length) {
                        return values[i];
                    }
                } catch (NumberFormatException ignored) {
                }
                // boolean-shaped values on enums: false -> first, true -> second
                Enum<?>[] values = ((Class<Enum>) fieldType).getEnumConstants();
                if (value.equalsIgnoreCase("true") && values.length > 1) {
                    return values[1];
                }
                if (value.equalsIgnoreCase("false") && values.length > 0) {
                    return values[0];
                }
                return null;
            }
        }
        return value;
    }

    // --- helpers -------------------------------------------------------

    private static void trySave(Object options) {
        try {
            options.getClass().getMethod("save").invoke(options);
        } catch (Throwable t) {
            System.out.println("[AzrealXBridge] options.save() failed: " + rootCause(t));
        }
    }

    /**
     * An open options screen (video, sound, mouse, ...) caches the widget
     * states from when it was built, so a live set() is not visible until the
     * screen is reopened. Re-run {@code init()} - exactly what Minecraft does
     * on a window resize - to rebuild the widgets from the current values.
     */
    private static void refreshOpenOptionsScreen(Object mc) {
        try {
            Object screen = null;
            // legacy: Minecraft#getScreen()
            try {
                screen = mc.getClass().getMethod("getScreen").invoke(mc);
            } catch (Throwable ignored) {
            }
            // 26.x: Minecraft.gui.screen()
            if (screen == null) {
                try {
                    Object gui = mc.getClass().getField("gui").get(mc);
                    screen = gui.getClass().getMethod("screen").invoke(gui);
                } catch (Throwable ignored) {
                }
            }
            if (screen == null) {
                return;
            }
            Class<?> sub = null;
            for (String n : new String[]{
                    "net.minecraft.client.gui.screens.options.OptionsSubScreen",
                    "net.minecraft.client.gui.screens.OptionsSubScreen"}) {
                try {
                    sub = Class.forName(n);
                    break;
                } catch (Throwable ignored) {
                    // not present in this MC version
                }
            }
            if (sub == null || !sub.isInstance(screen)) {
                return;
            }
            Method init = screen.getClass().getMethod("init");
            init.setAccessible(true);
            init.invoke(screen);
            System.out.println("[AzrealXBridge] refreshed open options screen");
        } catch (Throwable t) {
            System.out.println("[AzrealXBridge] screen refresh skipped: " + rootCause(t));
        }
    }

    /** unwraps InvocationTargetException chains for readable diagnostics */
    private static String rootCause(Throwable t) {
        Throwable cur = t;
        while (cur.getCause() != null && cur.getCause() != cur) {
            cur = cur.getCause();
        }
        return cur.getClass().getSimpleName() + ": " + cur.getMessage();
    }

    private static Object reflectStatic(String cls, String method) {
        try {
            return Class.forName(cls).getMethod(method).invoke(null);
        } catch (Throwable t) {
            return null;
        }
    }

    private static Object readField(Object target, String name) {
        try {
            Field f = target.getClass().getDeclaredField(name);
            f.setAccessible(true);
            return f.get(target);
        } catch (Throwable t) {
            return null;
        }
    }

    private static Method findMethod(Class<?> cls, String name) {
        try {
            return cls.getMethod(name, Runnable.class);
        } catch (Throwable t) {
            return null;
        }
    }

    private static String capitalize(String s) {
        if (s.isEmpty()) {
            return s;
        }
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }
}