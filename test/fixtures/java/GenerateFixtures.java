import com.google.common.collect.LinkedListMultimap;
import com.xiaomi.infra.galaxy.fds.auth.signature.SignAlgorithm;
import com.xiaomi.infra.galaxy.fds.auth.signature.Signer;
import com.xiaomi.infra.galaxy.fds.auth.signature.Utils;
import com.xiaomi.infra.galaxy.fds.model.HttpMethod;

import java.lang.reflect.Method;
import java.net.URI;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/**
 * Generates golden signature/pre-signed-URI fixtures by invoking the real
 * galaxy-fds-sdk-java 3.0.48 jar, emitting them as JSON to stdout. The Node.js
 * test suite asserts byte-for-byte equality against these fixtures.
 */
public class GenerateFixtures {

  static final String ACCESS_ID = "AKIDEXAMPLEACCESSID";
  static final String ACCESS_SECRET = "wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEKEY";

  // Accessor for the package-private Signer.constructStringToSign(...).
  static Method constructStringToSign;
  static {
    try {
      constructStringToSign = Signer.class.getDeclaredMethod(
          "constructStringToSign", HttpMethod.class, URI.class, LinkedListMultimap.class);
      constructStringToSign.setAccessible(true);
    } catch (NoSuchMethodException e) {
      throw new RuntimeException(e);
    }
  }

  static String jsonStr(String s) {
    if (s == null) return "null";
    StringBuilder b = new StringBuilder("\"");
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"': b.append("\\\""); break;
        case '\\': b.append("\\\\"); break;
        case '\n': b.append("\\n"); break;
        case '\r': b.append("\\r"); break;
        case '\t': b.append("\\t"); break;
        default:
          if (c < 0x20) {
            b.append(String.format("\\u%04x", (int) c));
          } else {
            b.append(c);
          }
      }
    }
    return b.append("\"").toString();
  }

  static String headersJson(LinkedListMultimap<String, String> headers) {
    StringBuilder b = new StringBuilder("[");
    boolean first = true;
    for (java.util.Map.Entry<String, String> e : headers.entries()) {
      if (!first) b.append(",");
      first = false;
      b.append("[").append(jsonStr(e.getKey())).append(",").append(jsonStr(e.getValue())).append("]");
    }
    return b.append("]").toString();
  }

  static String listJson(List<String> list) {
    if (list == null) return "null";
    StringBuilder b = new StringBuilder("[");
    for (int i = 0; i < list.size(); i++) {
      if (i > 0) b.append(",");
      b.append(jsonStr(list.get(i)));
    }
    return b.append("]").toString();
  }

  static final List<String> SIGN_CASES = new ArrayList<String>();
  static final List<String> PRESIGN_CASES = new ArrayList<String>();
  static final List<String> MD5_CASES = new ArrayList<String>();
  static final List<String> URLENCODE_CASES = new ArrayList<String>();

  static void md5Case(String input) throws Exception {
    String out = Utils.calcMD5(input);
    MD5_CASES.add("{\"input\":" + jsonStr(input) + ",\"expected\":" + jsonStr(out) + "}");
  }

  static void urlEncodeCase(String input) throws Exception {
    String out = Signer.urlEncode(input);
    URLENCODE_CASES.add("{\"input\":" + jsonStr(input) + ",\"expected\":" + jsonStr(out) + "}");
  }

  static void signCase(String name, HttpMethod method, String uri,
      LinkedListMultimap<String, String> headers, SignAlgorithm alg) throws Exception {
    URI u = new URI(uri);
    String stringToSign = (String) constructStringToSign.invoke(null, method, u, headers);
    String sig = Signer.signToBase64(method, u, headers, ACCESS_SECRET, alg);
    String auth = Signer.getAuthorizationHeader(method, u, headers, ACCESS_ID, ACCESS_SECRET, alg);
    StringBuilder b = new StringBuilder("{");
    b.append("\"name\":").append(jsonStr(name)).append(",");
    b.append("\"httpMethod\":").append(jsonStr(method.name())).append(",");
    b.append("\"uri\":").append(jsonStr(uri)).append(",");
    b.append("\"headers\":").append(headersJson(headers)).append(",");
    b.append("\"algorithm\":").append(jsonStr(alg.name())).append(",");
    b.append("\"accessId\":").append(jsonStr(ACCESS_ID)).append(",");
    b.append("\"accessSecret\":").append(jsonStr(ACCESS_SECRET)).append(",");
    b.append("\"expected\":{");
    b.append("\"stringToSign\":").append(jsonStr(stringToSign)).append(",");
    b.append("\"signature\":").append(jsonStr(sig)).append(",");
    b.append("\"authorizationHeader\":").append(jsonStr(auth));
    b.append("}}");
    SIGN_CASES.add(b.toString());
  }

  static void presignCase(String name, String baseUri, String bucket, String object,
      List<String> subResources, long expiresMillis, HttpMethod method,
      LinkedListMultimap<String, String> headers, SignAlgorithm alg) throws Exception {
    URI uri = Signer.generatePresignedUri(baseUri, bucket, object, subResources,
        new Date(expiresMillis), method, ACCESS_ID, ACCESS_SECRET, alg, headers);
    StringBuilder b = new StringBuilder("{");
    b.append("\"name\":").append(jsonStr(name)).append(",");
    b.append("\"baseUri\":").append(jsonStr(baseUri)).append(",");
    b.append("\"bucketName\":").append(jsonStr(bucket)).append(",");
    b.append("\"objectName\":").append(jsonStr(object)).append(",");
    b.append("\"subResources\":").append(listJson(subResources)).append(",");
    b.append("\"expiresMillis\":").append(expiresMillis).append(",");
    b.append("\"httpMethod\":").append(jsonStr(method.name())).append(",");
    b.append("\"headers\":").append(headers == null ? "null" : headersJson(headers)).append(",");
    b.append("\"algorithm\":").append(jsonStr(alg.name())).append(",");
    b.append("\"accessId\":").append(jsonStr(ACCESS_ID)).append(",");
    b.append("\"accessSecret\":").append(jsonStr(ACCESS_SECRET)).append(",");
    b.append("\"expected\":{\"uri\":").append(jsonStr(uri.toString())).append("}}");
    PRESIGN_CASES.add(b.toString());
  }

  static LinkedListMultimap<String, String> h(String... kv) {
    LinkedListMultimap<String, String> m = LinkedListMultimap.create();
    for (int i = 0; i + 1 < kv.length; i += 2) {
      m.put(kv[i], kv[i + 1]);
    }
    return m;
  }

  public static void main(String[] args) throws Exception {
    String base = "http://files.fds.api.xiaomi.com/";

    // ---- Signature cases ----
    signCase("get-no-headers", HttpMethod.GET, base + "my-bucket/my-object", h(), SignAlgorithm.HmacSHA1);
    signCase("get-with-date", HttpMethod.GET, base + "my-bucket/my-object",
        h("date", "Sun, 06 Nov 1994 08:49:37 GMT"), SignAlgorithm.HmacSHA1);
    signCase("put-content-type-md5", HttpMethod.PUT, base + "my-bucket/my-object",
        h("content-md5", "1B2M2Y8AsgTpgAmY7PhCfg==", "content-type", "application/octet-stream",
          "date", "Sun, 06 Nov 1994 08:49:37 GMT"), SignAlgorithm.HmacSHA1);
    signCase("xiaomi-date-overrides-date", HttpMethod.GET, base + "my-bucket/my-object",
        h("x-xiaomi-date", "Sun, 06 Nov 1994 08:49:37 GMT", "date", "Mon, 07 Nov 1994 08:49:37 GMT"),
        SignAlgorithm.HmacSHA1);
    signCase("xiaomi-headers-sorted-merged", HttpMethod.PUT, base + "my-bucket/my-object",
        h("x-xiaomi-meta-foo", "bar", "x-xiaomi-acl", "private", "x-xiaomi-meta-foo", "baz",
          "date", "Sun, 06 Nov 1994 08:49:37 GMT"), SignAlgorithm.HmacSHA1);
    signCase("multipart-form-data-collapsed", HttpMethod.POST, base + "my-bucket/",
        h("content-type", "multipart/form-data; boundary=----WebKitABC123",
          "date", "Sun, 06 Nov 1994 08:49:37 GMT"), SignAlgorithm.HmacSHA1);
    signCase("subresource-acl-in-resource", HttpMethod.GET, base + "my-bucket/my-object?acl",
        h("date", "Sun, 06 Nov 1994 08:49:37 GMT"), SignAlgorithm.HmacSHA1);
    signCase("subresources-sorted", HttpMethod.GET,
        base + "my-bucket/my-object?uploadId=abc123&partNumber=2&notsub=ignored&acl",
        h("date", "Sun, 06 Nov 1994 08:49:37 GMT"), SignAlgorithm.HmacSHA1);
    signCase("algorithm-sha256", HttpMethod.GET, base + "my-bucket/my-object",
        h("date", "Sun, 06 Nov 1994 08:49:37 GMT"), SignAlgorithm.HmacSHA256);
    signCase("algorithm-md5", HttpMethod.GET, base + "my-bucket/my-object",
        h("date", "Sun, 06 Nov 1994 08:49:37 GMT"), SignAlgorithm.HmacMD5);
    signCase("expires-in-uri", HttpMethod.GET,
        base + "my-bucket/my-object?GalaxyAccessKeyId=" + ACCESS_ID + "&Expires=1700000000000",
        h(), SignAlgorithm.HmacSHA1);

    // ---- Pre-signed URI cases ----
    presignCase("presign-get-basic", base, "my-bucket", "my-object", null,
        1700000000000L, HttpMethod.GET, null, SignAlgorithm.HmacSHA1);
    presignCase("presign-get-empty-object", base, "my-bucket", "", null,
        1700000000000L, HttpMethod.GET, null, SignAlgorithm.HmacSHA1);
    presignCase("presign-put", base, "my-bucket", "dir/sub/obj.txt", null,
        1700000000000L, HttpMethod.PUT, null, SignAlgorithm.HmacSHA1);
    List<String> acl = new ArrayList<String>(); acl.add("acl");
    presignCase("presign-with-subresource-acl", base, "my-bucket", "my-object", acl,
        1700000000000L, HttpMethod.GET, null, SignAlgorithm.HmacSHA1);
    List<String> multi = new ArrayList<String>(); multi.add("metadata"); multi.add("acl");
    presignCase("presign-with-subresources-multi", base, "my-bucket", "my-object", multi,
        1700000000000L, HttpMethod.GET, null, SignAlgorithm.HmacSHA1);
    presignCase("presign-with-content-type", base, "my-bucket", "my-object", null,
        1700000000000L, HttpMethod.PUT, h("content-type", "image/png"), SignAlgorithm.HmacSHA1);
    presignCase("presign-with-content-type-md5", base, "my-bucket", "my-object", null,
        1700000000000L, HttpMethod.PUT,
        h("content-type", "image/png", "content-md5", "1B2M2Y8AsgTpgAmY7PhCfg=="),
        SignAlgorithm.HmacSHA1);
    presignCase("presign-cdn", "http://cdn.fds.api.xiaomi.com/", "my-bucket", "my-object", null,
        1700000000000L, HttpMethod.GET, null, SignAlgorithm.HmacSHA1);
    presignCase("presign-object-with-spaces", base, "my-bucket", "path with spaces/a+b.txt", null,
        1700000000000L, HttpMethod.GET, null, SignAlgorithm.HmacSHA1);

    // ---- calcMD5 cases ----
    md5Case("");
    md5Case("hello");
    md5Case("The quick brown fox jumps over the lazy dog");
    md5Case("中文字符串");
    md5Case("a/b/c?x=1&y=2");

    // ---- urlEncode cases ----
    urlEncodeCase("");
    urlEncodeCase("simple");
    urlEncodeCase("a+b/c*d~e");
    urlEncodeCase("path with spaces");
    urlEncodeCase("p+qjVTQ54pVld7OUrbO3ge5VinM=");
    urlEncodeCase("中文");
    urlEncodeCase("a.b-c_d");

    StringBuilder out = new StringBuilder();
    out.append("{\"signCases\":[");
    for (int i = 0; i < SIGN_CASES.size(); i++) {
      if (i > 0) out.append(",");
      out.append(SIGN_CASES.get(i));
    }
    out.append("],\"presignCases\":[");
    for (int i = 0; i < PRESIGN_CASES.size(); i++) {
      if (i > 0) out.append(",");
      out.append(PRESIGN_CASES.get(i));
    }
    out.append("],\"md5Cases\":[");
    for (int i = 0; i < MD5_CASES.size(); i++) {
      if (i > 0) out.append(",");
      out.append(MD5_CASES.get(i));
    }
    out.append("],\"urlEncodeCases\":[");
    for (int i = 0; i < URLENCODE_CASES.size(); i++) {
      if (i > 0) out.append(",");
      out.append(URLENCODE_CASES.get(i));
    }
    out.append("]}");
    System.out.println(out.toString());
  }
}
