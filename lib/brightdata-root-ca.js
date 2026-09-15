// Bright Data root CA (public), used ONLY to verify TLS on Reddit fetches that go
// through the Bright Data residential proxy on port 44445. Bright Data terminates
// TLS itself and re-signs with this root; verifying against it keeps certificate
// checking ON instead of the ignoreHTTPSErrors shortcut. Embedded as a string so
// serverless bundling never has to trace a .crt file.
// Subject: C=US, O=Bright Data, CN=Bright Data Root CA  (valid 2026-07-23 to 2046-07-18)
// SHA-256: DB:85:48:F8:A5:B1:16:65:36:92:0C:CD:04:73:84:0F:7F:DB:AF:16:5D:ED:F9:07:B7:B5:23:61:AB:C8:7B:60
// Source: https://brightdata.com/static/brightdata_proxy_ca.zip (brightdata_root_ca_44445.crt)
export const BRIGHTDATA_ROOT_CA = `-----BEGIN CERTIFICATE-----
MIIFUjCCAzqgAwIBAgIUTSJLZKXAgmk1CXzUfozvn7aLr8MwDQYJKoZIhvcNAQEM
BQAwQTELMAkGA1UEBhMCVVMxFDASBgNVBAoMC0JyaWdodCBEYXRhMRwwGgYDVQQD
DBNCcmlnaHQgRGF0YSBSb290IENBMB4XDTI2MDcyMzAwMDAwMFoXDTQ2MDcxODAw
MDAwMFowQTELMAkGA1UEBhMCVVMxFDASBgNVBAoMC0JyaWdodCBEYXRhMRwwGgYD
VQQDDBNCcmlnaHQgRGF0YSBSb290IENBMIICIjANBgkqhkiG9w0BAQEFAAOCAg8A
MIICCgKCAgEAxxwrEncBfM+6VPbe9Lf+S7FU1PGub2vliDQm9Poh58raNyBec/JP
JUnTrbqPZR8+eryzYgOf7+lcBZOa/r6aMK/EXB+mbFdZgYCKurWqo7YrPGaUJSia
gwvcfSdoyb6c7nnL3/NMw28RPu9FSsde0Gk0wWcjYk6EZKwKPNq4DE55g0zmezNe
G1tr5H6kRJIKlzJWY4BhesPUyk44C9itKFYX9VNrPpSROoP3jXdZSY3EDvcIRQCP
y6KzRIF0MCgOP0X72rXQPXoaK1OdpTWFvriQ8INJu1eWrKb5URxMKqEsm+t/96dG
QgNrTbIbgJnKuSWE86+zpnZksyfk+UANQ9/axzVLTOs3N9XId2etTR0WXYdvd2ft
day0fx6zvpBHM6U9+arVt5wxAY/h5z7ycCzXFDpjn26s6d+NF2fV0rJA9gFGZsBl
k3Ifi4xXv2jHcSpFGEMnOTQ26ieHFsp5atD4fJMgETRbNJ42l6Nm26m1ckxVHbZY
ehisV0syWoa1kqzMq5BTlw0KiSkWT5AbYnBxHVjUKMvC9RtBSMAthrtyx4KEegWg
aJVY8APxgrtVQ6pBA3ncE7bD6PB292m+K+2MkHQ0ZnIM2KHsJGnsWID4S/D3IxyZ
mqnD4R0yqgVvpdHz1cDdHZab+dadcLbSTFfVRHP4Qvvqo7nkXMX0L4ECAwEAAaNC
MEAwDwYDVR0TAQH/BAUwAwEB/zAOBgNVHQ8BAf8EBAMCAYYwHQYDVR0OBBYEFKyq
uIF/9MapkAZcGIs3LnqzEdHrMA0GCSqGSIb3DQEBDAUAA4ICAQA5PG+rvFx2Qpr3
mo4n7/InqQuXsOM4AXwEkkQG96d31wuQjxPFTNaXLEq+2xcF8ke5FdKSW7TMyD33
r9FbWdspUc6Fy9L80ReDxVs+3+6Q8ACbMtySbNb6cjOrae2+fmzENqW7AC6xce5V
emu+e6x3VwubKNUHi7ilGQ7tY+xykFVJ7/RfjLy/9WSvL+DSWJAt2lgLs5Uj/BNw
DIY1kxwNrdrS1vnJ4PxYfO5FTdGsvMmJFHDrg2bmYa0mz9m0ben3BHMVs7HDHUkc
pIm+98ZPJgESS3YpBfj8Ysxq+WmQfAD2g7xiIL2IiwCoBaZlkV8/aEuvLEFJl6xZ
yZoCErMOCxb7rex1Tk7NGmsx/If/5gadcDBgMEdU4B5RV+yqUVEr3zTKPy+96lTR
ZzVmG3jjs2AWAGgT+yzghjLVWTtpf6kE5WREjomkhmUPC9aEZ51CGGhc8dncfbGX
TC3kjW3CERGqcA0uCFh1B+En82Z1Qrhfsxa1gxFfcJslMkkGO0jwkBXCcwLD8lxD
9XIjkeXwRPsKutNbk6OI08INyc8yveIR65uhbA2mWXKHGcRS6/lkVezTncBdxsoE
Qe0MtjLwEC9xAKFxAizeor4bRKdCjvbeTOHBaRzJXtIS9SZZtjqFSmEfpaGmwrnJ
aaCr34hU5WXc5BcniYlcNqaAkRuywg==
-----END CERTIFICATE-----
`;
