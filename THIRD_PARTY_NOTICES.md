# WebView2

The native Leafnote window uses Microsoft Edge WebView2 SDK 1.0.2365.46:

- Microsoft.Web.WebView2.Core.dll
- Microsoft.Web.WebView2.WinForms.dll
- WebView2Loader.dll (x64)

These Microsoft components were copied from this PC's existing Microsoft Office installation, without modification, for use with Leafnote. They are not covered by Leafnote's MIT license. WebView2 SDK licensing and redistribution terms are provided by Microsoft at https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.2365.46/License . The separately installed WebView2 Runtime is not bundled.

# Node.js

Release zip files bundle the official Node.js 24 LTS runtime (node.exe, MIT license; see runtime/NODE_LICENSE.txt in the zip) so Leafnote starts without installing Node.js. Source: https://nodejs.org/
