Upstream: https://github.com/flyfish-dev/file-viewer
Package: @file-viewer/web-full 3.1.1, Apache-2.0.
Unmodified IIFE loader and text/image/archive/pdf renderers from npm, loaded lazily and hosted locally.
Only PDF and libarchive runtime assets are shipped. Other renderer code/assets are excluded.
The host registers HTML/TXT/MD/JSON, code files supported by the text renderer, images, ZIP/7z/RAR/TAR and PDF.
The host preview-ui.js adapter customizes presentation while retaining upstream parsing and extraction.
HTML uses the upstream static sandbox preview (scripts are not executed).
Package integrity: sha512-sRAvdDhBmapqPIbHr3gGIjnyRN4WvnW42lm/V/GRmPHbC5yN13lRGBkHhJUAylWyf2TwOjQiCv1azznjeAWLUQ==
