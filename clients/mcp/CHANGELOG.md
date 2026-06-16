# @vultisig/mcp

## 0.1.18

### Patch Changes

- [#750](https://github.com/vultisig/vultisig-sdk/pull/750) [`0f6adc3`](https://github.com/vultisig/vultisig-sdk/commit/0f6adc3c73d06eb6da3758987dfaafb29d599019) Thanks [@gomesalexandre](https://github.com/gomesalexandre)! - security: bump transitive deps to fix 5 high-severity advisories

  - form-data: 4.0.5 -> 4.0.6 (CRLF injection, GHSA-hmw2-7cc7-3qxx)
  - protobufjs: 7.5.8 -> 7.6.4, 8.3.0 -> 8.6.3 (DoS via unbounded Any expansion, GHSA-wcpc-wj8m-hjx6)
  - tmp: 0.2.6 -> 0.2.7 (path traversal via type confusion, GHSA-7c78-jf6q-g5cm)
  - vite: 8.0.10 -> 8.0.16 (server.fs.deny bypass on Windows, GHSA-fx2h-pf6j-xcff)
  - ws: 7.5.10 -> 7.5.11, 8.17.1/8.20.x -> 8.21.0 (memory exhaustion DoS, GHSA-96hv-2xvq-fx4p)

  all bumped via yarn resolutions; no direct dep changes.

- Updated dependencies [[`b544eea`](https://github.com/vultisig/vultisig-sdk/commit/b544eea2bd6f30aef59d6465d89784c763b13c11), [`c78c10d`](https://github.com/vultisig/vultisig-sdk/commit/c78c10d2b43f9ddd13b2c912a71f7d902f2694cc), [`0f6adc3`](https://github.com/vultisig/vultisig-sdk/commit/0f6adc3c73d06eb6da3758987dfaafb29d599019)]:
  - @vultisig/sdk@2.3.3

## 0.1.17

### Patch Changes

- Updated dependencies [[`dc75595`](https://github.com/vultisig/vultisig-sdk/commit/dc75595e83360f5bda84b2d91cae177bc7c8c966)]:
  - @vultisig/sdk@2.0.0
  - @vultisig/client-shared@0.2.15

## 0.1.16

### Patch Changes

- [#683](https://github.com/vultisig/vultisig-sdk/pull/683) [`4561129`](https://github.com/vultisig/vultisig-sdk/commit/45611297a55da72d3c56b1a2ffe6522da1b64d7b) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Update SDK package dependencies and Yarn tooling.

- Updated dependencies [[`4561129`](https://github.com/vultisig/vultisig-sdk/commit/45611297a55da72d3c56b1a2ffe6522da1b64d7b)]:
  - @vultisig/client-shared@0.2.14
  - @vultisig/sdk@1.8.10

## 0.1.15

### Patch Changes

- [#642](https://github.com/vultisig/vultisig-sdk/pull/642) [`cc7fc61`](https://github.com/vultisig/vultisig-sdk/commit/cc7fc61f7720f8c218bccc90b276808c71263651) Thanks [@rcoderdev](https://github.com/rcoderdev)! - Accept documented `vmcp --vault <id-or-path>` arguments and reject unknown MCP CLI options.

- Updated dependencies [[`72bbcd1`](https://github.com/vultisig/vultisig-sdk/commit/72bbcd17ee5327390c98784f861b7c6b8829cf2f)]:
  - @vultisig/sdk@1.8.2

## 0.1.14

### Patch Changes

- Updated dependencies [[`fa95600`](https://github.com/vultisig/vultisig-sdk/commit/fa95600887cb8ca603e8ddcb9c8558eff2d0ea6b)]:
  - @vultisig/sdk@1.0.0
  - @vultisig/client-shared@0.2.13

## 0.1.13

### Patch Changes

- Updated dependencies [[`cb21dcf`](https://github.com/vultisig/vultisig-sdk/commit/cb21dcf127e8e08ceaca76439fa28d557cf0fed9)]:
  - @vultisig/sdk@0.28.0
  - @vultisig/client-shared@0.2.12

## 0.1.12

### Patch Changes

- Updated dependencies [[`9a80907`](https://github.com/vultisig/vultisig-sdk/commit/9a8090721008f2a10dffa9cf2d3fac479d65481c)]:
  - @vultisig/sdk@0.27.0
  - @vultisig/client-shared@0.2.11

## 0.1.11

### Patch Changes

- Updated dependencies [[`cb80440`](https://github.com/vultisig/vultisig-sdk/commit/cb804408b9607aacb143a7a941f0f9f1986f2379)]:
  - @vultisig/sdk@0.26.0
  - @vultisig/client-shared@0.2.10

## 0.1.10

### Patch Changes

- Updated dependencies [[`c2fd086`](https://github.com/vultisig/vultisig-sdk/commit/c2fd08670ad67e9ec93443569f9b9b9aa5f9d685), [`1667b79`](https://github.com/vultisig/vultisig-sdk/commit/1667b79fbc754e36032942fb5e749706dfc09bf3), [`46274d7`](https://github.com/vultisig/vultisig-sdk/commit/46274d70fe19fb2f44bc90d9ec0cd4ac1994ae69), [`0c9f6d5`](https://github.com/vultisig/vultisig-sdk/commit/0c9f6d5139d4a096645a575505c7550c2b26bd2a)]:
  - @vultisig/sdk@0.25.0
  - @vultisig/client-shared@0.2.9

## 0.1.9

### Patch Changes

- Updated dependencies [[`bd0daf9`](https://github.com/vultisig/vultisig-sdk/commit/bd0daf9a8156c9927643cba8c1af98a2a6d5da56), [`37c2f82`](https://github.com/vultisig/vultisig-sdk/commit/37c2f82379725ac4ac4d63679afea5c3ac1b7683)]:
  - @vultisig/sdk@0.24.0
  - @vultisig/client-shared@0.2.8

## 0.1.8

### Patch Changes

- Updated dependencies [[`fde60dc`](https://github.com/vultisig/vultisig-sdk/commit/fde60dcc9f9822e21c2dbaeaacb9afb45cff0955), [`a6db82f`](https://github.com/vultisig/vultisig-sdk/commit/a6db82fd103ea8eea01a084cc8fbd787367db437)]:
  - @vultisig/sdk@0.23.0
  - @vultisig/client-shared@0.2.7

## 0.1.7

### Patch Changes

- Updated dependencies [[`feac01f`](https://github.com/vultisig/vultisig-sdk/commit/feac01f3225738a14c0123e1c3d70e46b97760fd), [`a3a331a`](https://github.com/vultisig/vultisig-sdk/commit/a3a331a875ebc6868b11c6901c8ed99dde51a4ff)]:
  - @vultisig/sdk@0.22.0
  - @vultisig/client-shared@0.2.6

## 0.1.6

### Patch Changes

- Updated dependencies [[`bad88d8`](https://github.com/vultisig/vultisig-sdk/commit/bad88d8d87229284c739995c027eb33d3ffc19e3)]:
  - @vultisig/sdk@0.21.0
  - @vultisig/client-shared@0.2.5

## 0.1.5

### Patch Changes

- Updated dependencies [[`1d1c02c`](https://github.com/vultisig/vultisig-sdk/commit/1d1c02c37e58340b0617eec3a5e44909efc9b452)]:
  - @vultisig/sdk@0.20.0
  - @vultisig/client-shared@0.2.4

## 0.1.4

### Patch Changes

- Updated dependencies [[`c5f9c7b`](https://github.com/vultisig/vultisig-sdk/commit/c5f9c7bcac80d30f0b5e086c9e6860eaa0cf79a9)]:
  - @vultisig/sdk@0.19.0
  - @vultisig/client-shared@0.2.3

## 0.1.3

### Patch Changes

- Updated dependencies [[`2018787`](https://github.com/vultisig/vultisig-sdk/commit/2018787f8101ea9a98e975c0e7477245c3f86fad), [`f52057b`](https://github.com/vultisig/vultisig-sdk/commit/f52057b4af859018d1c180fa6db9ce15e153409f)]:
  - @vultisig/sdk@0.18.0
  - @vultisig/client-shared@0.2.2

## 0.1.2

### Patch Changes

- Updated dependencies [[`219cb00`](https://github.com/vultisig/vultisig-sdk/commit/219cb00898deeaac418945a89c1d243f25aae152)]:
  - @vultisig/sdk@0.17.0
  - @vultisig/client-shared@0.2.1

## 0.1.1

### Patch Changes

- Updated dependencies [[`0388700`](https://github.com/vultisig/vultisig-sdk/commit/03887009b7579fc0b193d068d4a205cdd3b7c214), [`83fe4c3`](https://github.com/vultisig/vultisig-sdk/commit/83fe4c3c58637aea4823d0eaa7f21d4c5cdf3dc7)]:
  - @vultisig/client-shared@0.2.0
  - @vultisig/sdk@0.16.0
