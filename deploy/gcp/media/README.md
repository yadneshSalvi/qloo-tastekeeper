# TASTEKEEPER demonstration film hosting

This separate static service serves only the approved final MP4, poster and WebVTT captions. The page offers native playback controls, optional English captions, downloads, and verified application/source links. It uses a dedicated roleless media identity, minimum zero / maximum one instance, and no database, secrets, VPC, provider credentials or application state.

Prepare the context only after reviewing the final assets. Never upload the film project, captures, production transcripts, plans, or raw provider data. Run from the TASTEKEEPER repository:

```sh
python3 deploy/gcp/media/prepare.py \
  --video /absolute/path/to/TASTEKEEPER-demo.mp4 \
  --poster /absolute/path/to/TASTEKEEPER-poster.png \
  --captions /absolute/path/to/TASTEKEEPER-demo.vtt \
  --app-url https://VERIFIED_PUBLIC_APP_ORIGIN \
  --source-url https://github.com/VERIFIED_OWNER/VERIFIED_REPOSITORY \
  --output /absolute/private/new-media-build
```

The output must be outside this repository. Preparation checks an MP4 container no larger than 128 MiB, PNG/JPEG poster data, and nonempty WebVTT captions. It substitutes the public URLs, selects the poster MIME type, and stages exactly eight regular files: `.gcloudignore`, `Dockerfile`, `cloudbuild.yaml`, `nginx.conf`, `index.html`, `TASTEKEEPER-demo.mp4`, `poster`, and `captions.vtt`. The generated ignore file admits only those eight files. Save the printed SHA-256 media manifest with private release evidence.

After final publication approval, create the dedicated `tastekeeper-film` service account with no project roles. It must also have no resource-level secret grants. Set `TASTEKEEPER_MEDIA_BUILD_DIR` to the prepared directory and `TASTEKEEPER_MEDIA_IMAGE` to a unique tag in the project's `tastekeeper-images` Artifact Registry repository. Select the authorized Google Cloud account/wrapper as described in the parent deployment README, then run `./deploy/gcp/media/publish.sh`.

The script verifies the exact context and roleless identity, builds only the staged files, resolves an immutable digest, and deploys `tastekeeper-demo` in `us-central1` with an HTTP/2 (h2c) connection to Nginx. It explicitly clears environment variables, secrets and VPC connections. The service uses request-based compute, 512 MiB memory and scale-to-zero; builds, registry storage, traffic and compute usage are billed separately. No media or application service is modified until publication is approved and the script is run.

Before sharing the public HTTPS URL, verify anonymous page access, asset SHA-256 matches, MIME types (`video/mp4`, `image/png` or `image/jpeg`, and `text/vtt`), a 206 response with correct `Content-Range`, and playback, seeking and optional native captions in a fresh browser. Nginx allows only the page, three assets and health endpoint, disables directory listing/access logs, and supplies restrictive response headers. Never publish unfilled URL placeholders.

Versioned asset URLs keep the player, poster, video and optional captions on the same media release. The current v2 film is 212.800 seconds at 1920×1080/30 fps, with actual application interactions at their recorded pace and no burned-in captions.

The `tastekeeper-media` identity belongs to the Tonight application client. Do not reuse it for this static film service. The verified [public film](https://tastekeeper-demo-hqzgkrycbq-uc.a.run.app) is published. Its asset hashes, deployment revision, and validation scope are recorded in [release evidence](../../../docs/RELEASE.md).
