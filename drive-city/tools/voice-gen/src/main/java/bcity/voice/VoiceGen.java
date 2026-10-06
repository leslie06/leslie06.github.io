package bcity.voice;

import com.alibaba.dashscope.audio.ttsv2.SpeechSynthesisAudioFormat;
import com.alibaba.dashscope.audio.ttsv2.SpeechSynthesisParam;
import com.alibaba.dashscope.audio.ttsv2.SpeechSynthesizer;
import com.alibaba.dashscope.utils.Constants;
import com.google.gson.JsonArray;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * NPC lines through Bailian CosyVoice (assets/voice/lines.json).
 *
 * <pre>
 *   design  [--archetypes a,b]           create each archetype's voices from its voiceDesign prompts (CosyVoice
 *                                        voice design: cosyvoice-v3.5-plus has no system voices), write the voice
 *                                        ids into its "voices" and the previews to assets/voice/design/
 *   synth   [--archetypes a,b] [--dry-run]  every line x every voice x variants, non-streaming, instruction =
 *                                        archetype style + line instruct, seed = the variant number, into
 *                                        assets/voice/raw/{id}_{voice}_{n}.mp3; files already there are skipped
 *   page                                 assets/voice/preview.html: every clip and design preview to listen to
 * </pre>
 *
 * The API key comes from DASHSCOPE_API_KEY. Calls are paced under the model's 180 requests a minute.
 * DASHSCOPE_WS_URL / DASHSCOPE_CUSTOMIZATION_URL override the endpoints (e.g. a workspace's own domain).
 */
public final class VoiceGen {
  private static final String CUSTOMIZATION_URL = env("DASHSCOPE_CUSTOMIZATION_URL",
      "https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization");
  /** 180 a minute is the model's limit: keep a margin for retries and anything else on the key. */
  private static final RateLimiter LIMIT = new RateLimiter(160);
  private static final int PARALLEL = 6;

  private final Path root, linesFile, rawDir, designDir;
  private final JsonObject doc;

  private VoiceGen(Path root) throws IOException {
    this.root = root;
    this.linesFile = root.resolve("assets/voice/lines.json");
    this.rawDir = root.resolve("assets/voice/raw");
    this.designDir = root.resolve("assets/voice/design");
    this.doc = JsonParser.parseString(Files.readString(linesFile)).getAsJsonObject();
  }

  public static void main(String[] args) throws Exception {
    String cmd = args.length > 0 ? args[0] : "help";
    Set<String> only = new LinkedHashSet<>();
    boolean dry = false;
    Path root = null;
    for (int i = 1; i < args.length; i++) {
      switch (args[i]) {
        case "--archetypes" -> { for (String a : args[++i].split(",")) if (!a.isBlank()) only.add(a.trim()); }
        case "--dry-run" -> dry = true;
        case "--root" -> root = Path.of(args[++i]);
        default -> { System.err.println("unknown option " + args[i]); System.exit(2); }
      }
    }
    if (root == null) root = findRoot();
    String ws = System.getenv("DASHSCOPE_WS_URL");
    if (ws != null && !ws.isBlank()) Constants.baseWebsocketApiUrl = ws;
    VoiceGen g = new VoiceGen(root);
    int failed = switch (cmd) {
      case "design" -> g.design(only);
      case "synth" -> g.synth(only, dry);
      case "page" -> { g.page(); yield 0; }
      default -> {
        System.out.println("usage: voice-gen design|synth|page [--archetypes uncle,driver] [--dry-run] [--root dir]");
        yield 0;
      }
    };
    System.exit(failed > 0 ? 1 : 0);
  }

  // ---------------------------------------------------------------- design

  private int design(Set<String> only) throws Exception {
    String key = apiKey();
    String model = tts().get("model").getAsString();
    int sampleRate = tts().get("sampleRate").getAsInt();
    HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(20)).build();
    Files.createDirectories(designDir);
    int failed = 0;
    for (var e : archetypes().entrySet()) {
      String arch = e.getKey();
      JsonObject a = e.getValue();
      if (!only.isEmpty() && !only.contains(arch)) continue;
      JsonArray prompts = a.has("voiceDesign") ? a.getAsJsonArray("voiceDesign") : new JsonArray();
      List<String> voices = strings(a.getAsJsonArray("voices"));
      if (voices.size() >= prompts.size()) { System.out.printf("%s: %d voices already, skipped%n", arch, voices.size()); continue; }
      for (int i = voices.size(); i < prompts.size(); i++) {
        JsonObject p = prompts.get(i).getAsJsonObject();
        String previewText = p.get("previewText").getAsString();
        if (previewText.codePointCount(0, previewText.length()) < 15) {   // the API refuses shorter ones
          System.err.printf("%s #%d: previewText must be 15 characters or more: %s%n", arch, i + 1, previewText);
          failed++;
          break;
        }
        JsonObject input = new JsonObject();
        input.addProperty("action", "create_voice");
        input.addProperty("target_model", model);
        input.addProperty("voice_prompt", p.get("prompt").getAsString());
        input.addProperty("preview_text", p.get("previewText").getAsString());
        input.addProperty("prefix", (arch + (i + 1)).replaceAll("[^a-z0-9]", ""));
        JsonObject params = new JsonObject();
        params.addProperty("sample_rate", sampleRate);
        params.addProperty("response_format", "wav");
        JsonObject body = new JsonObject();
        body.addProperty("model", "voice-enrollment");
        body.add("input", input);
        body.add("parameters", params);
        LIMIT.acquire();
        HttpResponse<String> r = http.send(HttpRequest.newBuilder(URI.create(CUSTOMIZATION_URL))
            .header("Authorization", "Bearer " + key).header("Content-Type", "application/json")
            .timeout(Duration.ofSeconds(120))
            .POST(HttpRequest.BodyPublishers.ofString(body.toString(), StandardCharsets.UTF_8)).build(),
            HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        if (r.statusCode() / 100 != 2) {
          System.err.printf("%s #%d: HTTP %d %s%n", arch, i + 1, r.statusCode(), r.body());
          failed++;
          break;
        }
        JsonObject out = JsonParser.parseString(r.body()).getAsJsonObject().getAsJsonObject("output");
        String voice = out.get("voice_id").getAsString();
        voices.add(voice);
        writeVoices(arch, voices);   // after each, so a failure later keeps what was made
        byte[] preview = previewBytes(http, out.get("preview_audio"));
        if (preview != null) Files.write(designDir.resolve(arch + "_" + (i + 1) + ".wav"), preview);
        System.out.printf("%s #%d: %s%s%n", arch, i + 1, voice, preview == null ? " (no preview)" : "");
      }
    }
    return failed;
  }

  private static byte[] previewBytes(HttpClient http, JsonElement p) throws Exception {
    if (p == null || p.isJsonNull()) return null;
    String s = p.isJsonObject() ? (p.getAsJsonObject().has("data") ? p.getAsJsonObject().get("data").getAsString()
        : p.getAsJsonObject().has("url") ? p.getAsJsonObject().get("url").getAsString() : null) : p.getAsString();
    if (s == null) return null;
    if (s.startsWith("http")) return http.send(HttpRequest.newBuilder(URI.create(s)).build(), HttpResponse.BodyHandlers.ofByteArray()).body();
    return Base64.getDecoder().decode(s.replaceFirst("^data:[^,]*,", ""));
  }

  /** Put an archetype's voice ids into lines.json, leaving the rest of its hand-made layout as it is. */
  private void writeVoices(String arch, List<String> voices) throws IOException {
    String text = Files.readString(linesFile);
    Matcher block = Pattern.compile("\"" + Pattern.quote(arch) + "\"\\s*:\\s*\\{").matcher(text);
    if (!block.find()) throw new IOException("archetype " + arch + " not found in lines.json");
    Matcher v = Pattern.compile("\"voices\"\\s*:\\s*\\[[^\\]]*\\]").matcher(text);
    if (!v.find(block.end())) throw new IOException("no voices field for " + arch);
    StringBuilder list = new StringBuilder("\"voices\": [");
    for (int i = 0; i < voices.size(); i++) list.append(i > 0 ? ", " : "").append('"').append(voices.get(i)).append('"');
    list.append(']');
    Files.writeString(linesFile, text.substring(0, v.start()) + list + text.substring(v.end()));
    archetypes().get(arch).add("voices", toJson(voices));
  }

  // ---------------------------------------------------------------- synth

  private record Job(String id, String arch, String voice, int n, String text, String instruction, Path out) {}

  private int synth(Set<String> only, boolean dry) throws Exception {
    JsonObject tts = tts();
    String model = tts.get("model").getAsString();
    int variantsDefault = tts.get("variantsDefault").getAsInt();
    List<String> hints = strings(tts.getAsJsonArray("languageHints"));
    Map<String, JsonObject> archs = archetypes();
    List<Job> jobs = new ArrayList<>();
    int skipped = 0;
    Set<String> noVoices = new LinkedHashSet<>();
    for (JsonElement el : doc.getAsJsonArray("lines")) {
      JsonObject l = el.getAsJsonObject();
      String arch = l.get("archetype").getAsString();
      if (!only.isEmpty() && !only.contains(arch)) continue;
      JsonObject a = archs.get(arch);
      List<String> voices = strings(a.getAsJsonArray("voices"));
      if (voices.isEmpty()) { noVoices.add(arch); continue; }
      int variants = l.has("variants") ? l.get("variants").getAsInt() : variantsDefault;
      String instruction = a.get("style").getAsString() + l.get("instruct").getAsString();
      for (String voice : voices) {
        for (int n = 1; n <= variants; n++) {
          Path out = rawDir.resolve(l.get("id").getAsString() + "_" + voice + "_" + n + ".mp3");
          if (Files.isRegularFile(out) && Files.size(out) > 0) { skipped++; continue; }
          jobs.add(new Job(l.get("id").getAsString(), arch, voice, n, l.get("text").getAsString(), instruction, out));
        }
      }
    }
    if (!noVoices.isEmpty()) System.out.println("no voices yet (run design first): " + String.join(", ", noVoices));
    System.out.printf("%d to synthesise, %d already there%n", jobs.size(), skipped);
    if (dry) { for (Job j : jobs) System.out.printf("  %s  seed %d  [%s] %s%n", j.out.getFileName(), j.n, j.instruction, j.text); return 0; }
    if (jobs.isEmpty()) return 0;
    String key = apiKey();
    Files.createDirectories(rawDir);
    AtomicInteger done = new AtomicInteger(), failed = new AtomicInteger();
    Semaphore slots = new Semaphore(PARALLEL);
    try (ExecutorService ex = Executors.newVirtualThreadPerTaskExecutor()) {
      List<Future<?>> fs = new ArrayList<>();
      for (Job j : jobs) {
        fs.add(ex.submit(() -> {
          slots.acquireUninterruptibly();
          try {
            byte[] audio = synthesizeWithRetry(key, model, hints, j);
            Path part = j.out.resolveSibling(j.out.getFileName() + ".part");
            Files.write(part, audio);
            Files.move(part, j.out, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
            System.out.printf("[%d/%d] %s (%d KB)%n", done.incrementAndGet(), jobs.size(), j.out.getFileName(), audio.length / 1024);
          } catch (Exception e) {
            failed.incrementAndGet();
            System.err.printf("FAILED %s: %s%n", j.out.getFileName(), e.getMessage());
          } finally {
            slots.release();
          }
          return null;
        }));
      }
      for (Future<?> f : fs) f.get();
    }
    System.out.printf("done: %d made, %d failed%n", done.get(), failed.get());
    return failed.get();
  }

  private static byte[] synthesizeWithRetry(String key, String model, List<String> hints, Job j) throws Exception {
    Exception last = null;
    for (int attempt = 0; attempt < 5; attempt++) {
      LIMIT.acquire();
      SpeechSynthesisParam p = SpeechSynthesisParam.builder()
          .apiKey(key).model(model).voice(j.voice)
          .format(SpeechSynthesisAudioFormat.MP3_24000HZ_MONO_256KBPS)
          .parameter("bit_rate", 64)
          .seed(j.n)
          .instruction(j.instruction)
          .languageHints(hints)
          .build();
      SpeechSynthesizer s = new SpeechSynthesizer(p, null);   // a new one for every call (the SDK's rule)
      try {
        ByteBuffer audio = s.call(j.text);
        if (audio != null && audio.remaining() > 0) {
          byte[] b = new byte[audio.remaining()];
          audio.get(b);
          return b;
        }
        last = new IOException("empty audio");
      } catch (Exception e) {
        last = e;
      } finally {
        try { s.getDuplexApi().close(1000, "bye"); } catch (Exception ignored) { /* already closed */ }
      }
      String m = String.valueOf(last.getMessage());
      boolean throttled = m.contains("Throttl") || m.contains("429") || m.contains("RateQuota") || m.contains("limit");
      Thread.sleep((throttled ? 8000L : 2000L) * (attempt + 1));
    }
    throw last;
  }

  // ---------------------------------------------------------------- page

  private void page() throws IOException {
    Map<String, JsonObject> archs = archetypes();
    StringBuilder h = new StringBuilder();
    h.append("""
        <!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <title>NPC 语音试听</title><style>
        :root{--bg:#f6f5f1;--fg:#1d1f22;--mut:#6b6f76;--card:#fff;--line:#e2e0d9;--acc:#c0392b}
        @media (prefers-color-scheme:dark){:root{--bg:#16181b;--fg:#ecebe6;--mut:#9aa0a8;--card:#1f2226;--line:#30343a;--acc:#ff7a6b}}
        body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,"PingFang SC",sans-serif}
        main{max-width:1100px;margin:0 auto;padding:20px 16px 60px}h1{font-size:22px;margin:0 0 4px}
        h2{font-size:18px;margin:28px 0 6px;border-bottom:2px solid var(--line);padding-bottom:4px}
        .mut{color:var(--mut);font-size:13px}.line{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0}
        .txt{font-weight:600;font-size:16px}.row{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;margin-top:6px}
        .v{font:12px ui-monospace,monospace;color:var(--mut);min-width:100%}.clip{display:flex;align-items:center;gap:4px}
        .clip span{font-size:12px;color:var(--mut)}audio{height:30px;width:210px}.miss{color:var(--acc);font-size:12px}
        </style></head><body><main><h1>NPC 语音试听</h1>
        """);
    h.append("<p class=\"mut\">模型 ").append(esc(tts().get("model").getAsString()))
        .append(" · 每句 = 原型 style + 本句 instruct · 版本号 = seed · 文件在 assets/voice/raw/</p>\n");
    for (var e : archs.entrySet()) {
      String arch = e.getKey();
      JsonObject a = e.getValue();
      List<String> voices = strings(a.getAsJsonArray("voices"));
      List<JsonObject> lines = new ArrayList<>();
      for (JsonElement el : doc.getAsJsonArray("lines")) if (el.getAsJsonObject().get("archetype").getAsString().equals(arch)) lines.add(el.getAsJsonObject());
      boolean any = false;
      for (JsonObject l : lines) for (String v : voices) if (Files.exists(rawDir.resolve(l.get("id").getAsString() + "_" + v + "_1.mp3"))) any = true;
      if (!any) continue;
      h.append("<h2>").append(esc(a.get("name").getAsString())).append(" <span class=\"mut\">").append(esc(arch)).append("</span></h2>\n");
      h.append("<p class=\"mut\">").append(esc(a.get("style").getAsString())).append("</p>\n");
      JsonArray prompts = a.has("voiceDesign") ? a.getAsJsonArray("voiceDesign") : new JsonArray();
      for (int i = 0; i < voices.size(); i++) {
        Path pv = designDir.resolve(arch + "_" + (i + 1) + ".wav");
        h.append("<div class=\"row\"><b>音色 ").append(i + 1).append("</b>");
        if (Files.exists(pv)) h.append("<span class=\"clip\"><span>设计试听</span><audio controls preload=\"none\" src=\"design/").append(pv.getFileName()).append("\"></audio></span>");
        h.append("<span class=\"v\">").append(esc(voices.get(i)));
        if (i < prompts.size()) h.append(" — ").append(esc(prompts.get(i).getAsJsonObject().get("prompt").getAsString()));
        h.append("</span></div>\n");
      }
      int variantsDefault = tts().get("variantsDefault").getAsInt();
      for (JsonObject l : lines) {
        String id = l.get("id").getAsString();
        int variants = l.has("variants") ? l.get("variants").getAsInt() : variantsDefault;
        h.append("<div class=\"line\"><div class=\"txt\">").append(esc(l.get("text").getAsString())).append("</div>")
            .append("<div class=\"mut\">").append(esc(id)).append(" · ").append(esc(l.get("trigger").getAsString()))
            .append(" · ").append(esc(l.get("emotion").getAsString())).append(" · ").append(esc(l.get("instruct").getAsString())).append("</div>");
        for (int vi = 0; vi < voices.size(); vi++) {
          h.append("<div class=\"row\"><b>音色 ").append(vi + 1).append("</b>");
          for (int n = 1; n <= variants; n++) {
            String f = id + "_" + voices.get(vi) + "_" + n + ".mp3";
            if (Files.exists(rawDir.resolve(f))) h.append("<span class=\"clip\"><span>#").append(n).append("</span><audio controls preload=\"none\" src=\"raw/").append(esc(f)).append("\"></audio></span>");
            else h.append("<span class=\"miss\">#").append(n).append(" 未生成</span>");
          }
          h.append("</div>");
        }
        h.append("</div>\n");
      }
    }
    h.append("""
        </main><script>
        // one clip at a time
        document.addEventListener('play', (e) => { for (const a of document.querySelectorAll('audio')) if (a !== e.target) a.pause(); }, true);
        </script></body></html>
        """);
    Path out = root.resolve("assets/voice/preview.html");
    Files.writeString(out, h);
    System.out.println("wrote " + out);
  }

  // ---------------------------------------------------------------- helpers

  private JsonObject tts() { return doc.getAsJsonObject("tts"); }

  private Map<String, JsonObject> archetypes() {
    Map<String, JsonObject> m = new LinkedHashMap<>();
    for (var e : doc.getAsJsonObject("archetypes").entrySet()) m.put(e.getKey(), e.getValue().getAsJsonObject());
    return m;
  }

  private static List<String> strings(JsonArray a) {
    List<String> out = new ArrayList<>();
    if (a != null) for (JsonElement e : a) out.add(e.getAsString());
    return out;
  }

  private static JsonArray toJson(List<String> xs) {
    JsonArray a = new JsonArray();
    xs.forEach(a::add);
    return a;
  }

  private static String apiKey() {
    String k = System.getenv("DASHSCOPE_API_KEY");
    if (k == null || k.isBlank()) { System.err.println("DASHSCOPE_API_KEY is not set"); System.exit(2); }
    return k;
  }

  private static String env(String k, String def) {
    String v = System.getenv(k);
    return v == null || v.isBlank() ? def : v;
  }

  private static String esc(String s) {
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;");
  }

  /** The directory holding assets/voice/lines.json: here or any parent. */
  private static Path findRoot() {
    for (Path p = Path.of("").toAbsolutePath(); p != null; p = p.getParent()) {
      if (Files.isRegularFile(p.resolve("assets/voice/lines.json"))) return p;
    }
    System.err.println("assets/voice/lines.json not found here or above; pass --root");
    System.exit(2);
    return null;
  }

  /** Requests spaced evenly under a per-minute cap, shared by every thread. */
  static final class RateLimiter {
    private final long gapNanos;
    private long next = System.nanoTime();

    RateLimiter(int perMinute) { this.gapNanos = 60_000_000_000L / perMinute; }

    void acquire() throws InterruptedException {
      long at;
      synchronized (this) {
        long now = System.nanoTime();
        at = Math.max(now, next);
        next = at + gapNanos;
      }
      long wait = at - System.nanoTime();
      if (wait > 0) Thread.sleep(Duration.ofNanos(wait));
    }
  }
}
