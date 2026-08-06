<h1 align="center">QuotaPin for Codex</h1>

<p align="center">
  <strong>メニューを開かず、Codex の残量を確認。</strong><br>
  QuotaPin は残りのパーセントを、いつものアカウント欄に追加します。
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.zh-CN.md">简体中文</a> · <a href="README.ja.md">日本語</a>
</p>

<p align="center">
  <img alt="Windows 11 で確認済み" src="https://img.shields.io/badge/Windows_11-確認済み-111827?style=flat-square">
  <img alt="データはローカルのみ" src="https://img.shields.io/badge/データ-ローカルのみ-10b981?style=flat-square">
  <img alt="MIT ライセンス" src="https://img.shields.io/badge/ライセンス-MIT-6366f1?style=flat-square">
</p>

## クイックスタート

Windows PowerShell を開き、次の1行を貼り付けます：

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/WSL043/QuotaPin-for-Codex/main/install.ps1)))
```

このコマンドは最新の安定版をインストールします。あとは、いつものアイコンから Codex を起動します。すでに動いている Codex は終了せず、QuotaPin は次回の通常起動を待ちます。過去版やプレリリースを明示的に使う場合だけ、`-Version '<version>'` を追加します。

<p align="center">
  <img src="assets/screenshots/product-ja.png" width="960" alt="アカウントメニューを開かず、Codex のアカウント欄に残り1パーセントを表示する QuotaPin">
</p>

> [!IMPORTANT]
> QuotaPin は非公式のコミュニティプロジェクトです。OpenAI との提携、承認、サポート関係はありません。

## クリックをひとつ減らして、集中を守る

短押しは通常の Codex アカウントメニュー、長押しは QuotaPin。もう一度押すか、パネルの外をクリックすると閉じます。ヘルプボタン、アバター、アカウント名はそのままです。

<details>
<summary>動作要件と初回起動</summary>

- **確認済み：** x64 版 Windows 11 と、サインイン済みの Codex Desktop。
- **ベストエフォート：** x64 版 Windows 10 バージョン 2004（ビルド 19041）以降。Windows ARM64 は未対応です。
- **権限：** 現在のユーザーだけにインストールされ、管理者権限は不要です。
- **実行中の作業：** インストールと更新は Codex を終了・再起動しません。安全に接続できない場合は、次回の通常起動を待ちます。

リポジトリを取得済みの場合は、`Restricted` 実行ポリシーでも次のコマンドを利用できます：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
```

再インストールや更新でも、保存した表示設定は残ります。バージョン指定、ロールバック、設定の復旧は[設定ガイド](docs/configuration.md)をご覧ください。

</details>

## 最初はシンプル、必要なら細かく

初期状態では Codex 標準のアバターと名前を残し、パーセントだけを追加します。

<p align="center">
  <img src="assets/screenshots/states-ja.png" width="900" alt="QuotaPin の通常、注意、危険の3段階と、任意の残量ライン">
  <br><sub>初期値は 30% で注意、10% で危険。しきい値は変更できます。</sub>
</p>

<p align="center">
  <img src="assets/screenshots/examples-ja.png" width="900" alt="カウントダウン、ステータスのみ、並べ替えを含む QuotaPin の6つの表示例">
</p>

パーセント、ステータスドット、残量ライン、残り時間、秒単位カウントダウン、リセット日、リセット時刻は個別に表示・非表示・並べ替えができます。任意のトークンモジュールでは、この端末の本日分とアカウントの累計を表示できます。ホバーには正確な値と、本日分が端末単位であることも表示されます。コンパクト表示（`4d 8h`）は3言語共通で、日本語表示（`4日8時間`）は別のモジュールとして選べます。

<p align="center">
  <img src="assets/screenshots/drag-layout.gif" width="405" alt="QuotaPin のモジュールを左、右、中央へ動かすと、周りの項目が場所を空ける様子">
  <br><sub>左・右・中央へ。周りの項目が自然に場所を空けます。</sub>
</p>

- **かんたん：** 利用枠の期間、表示する項目、並びを決めます。
- **カスタマイズ：** 色、しきい値、ホバー内容、アバター形状、明暗、動きを調整します。
- **コード：** 検証済みの設定項目をすべて扱えます。崩れてもリセットできます。

よく使う組み合わせは、名前付きビューとして保存・切り替えできます。

## 読むのは残量だけです

QuotaPin が読むのは、この端末の Codex が返す残り使用量だけです。タスク内容、プロンプト、Cookie、アカウント情報は読み取らず、利用状況を外部へ送信しません。アカウント欄をひとつに特定できない場合は何も表示せず、Codex 公式パッケージも変更しません。

詳細：[設定](docs/configuration.md) · [セキュリティ](SECURITY.md) · [プライバシー](PRIVACY.md) · [構成](docs/architecture.md) · [確認済み互換性](docs/compatibility.md)

更新の確認は1日最大1回。確認なしでインストールすることも、Codex を再起動することもありません。その場で安全に接続できない場合、新版は次回の通常起動から有効になります。

## Mac 版は実機確認が必要です

GitHub Actions では単体実行できる macOS 開発版をビルドできますが、現在の Codex、Gatekeeper、実際のアカウント欄との互換性までは証明できません。必要な実機証拠と匿名化した報告先は [macOS 移植ガイド](docs/macos-port.md)にまとめています。

## アイデアとコントリビューション

まず[既存のアイデアを検索](https://github.com/WSL043/QuotaPin-for-Codex/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement+sort%3Areactions-%2B1-desc)し、同じ案には 👍 を。なければ[新しいアイデアを投稿](https://github.com/WSL043/QuotaPin-for-Codex/issues/new?template=feature.yml)できます。コードを送る前に [CONTRIBUTING.md](CONTRIBUTING.md)をご覧ください。

## アンインストール

**スタート > QuotaPin > Uninstall QuotaPin** を開くか、次を実行します：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\QuotaPin\uninstall.ps1"
```

QuotaPin が削除するのは、自身のファイルとショートカットだけです。Codex はそのまま残ります。
