{ pkgs ? import <nixpkgs> {} }:

with pkgs;
with vscode-extensions;
with vscode-utils;
stdenv.mkDerivation {
  name = "regolith-env";
  buildInputs = [
    cmake
    (vscode-with-extensions.override {
      vscode = vscodium;
      vscodeExtensions = extensionsFromVscodeMarketplace [{
        name = "nix-ide";
        publisher = "jnoortheen";
        version = "0.1.12";
        sha256 = "1wkc5mvxv7snrpd0py6x83aci05b9fb9v4w9pl9d1hyaszqbfnif";
      }];
    })
    nodejs-16_x
  ];
}
