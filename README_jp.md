# Git コマンド MCP サーバー

これは、様々な Git コマンドを実行するためのツールを提供する Model Context Protocol (MCP) サーバーです。

ローカルにgit（git.exe）コマンドがインストールされていることが必要です。

大部分が生成AIにて作成されているので、お気づきの点がありましたら、http://github.com/ukiuni/mcp-git までご連絡ください。

## セットアップ

###　GitHubからClone
1.  **(まだの場合) リポジトリをクローンします:**
    ```bash
    git clone http://github.com/ukiuni/mcp-git.git
    cd mcp-git
    ```
2.  **依存関係をインストールします:**
    Node.js と npm がインストールされていることを確認してください。その後、以下を実行します:
    ```bash
    npm install
    ```

## MCP クライアントからの接続

MCP クライアント (Roo Code, GitHub Copilot,Claude Desktop, Cursor など) から接続する際は、以下の設定をしてください。

```
{
  "mcpServers": {
    "mpc-git": {
      "command": "node",
      "args": [
        "/path_to_mcp-git/mcp-git/dist/index.js"
      ]
    }
  }
}
```

path_to_mcpはgit cloneしたディレクトリへの絶対パスとしてください。

## 利用可能なツール
各ツール名は、`git-` というプレフィックスにコマンド名が続く形式です (例: `git-add`, `git-commit`, `git-status`)。

### ツールの出力
ツールの実行結果はテキストコンテンツとして返され、通常は以下を含みます:

*   `STDOUT`: Git コマンドからの標準出力。
*   `STDERR`: Git コマンドからの標準エラー出力 (注意: Git において stderr は必ずしもエラーを示すわけではありません)。
*   `ERROR`: サーバー自体で発生した実行エラー。

コマンドが出力なしで成功した場合、成功した旨のメッセージが提供されます。

## ライセンス

このプロジェクトは MIT ライセンスの下でライセンスされています - 詳細は [LICENSE](LICENSE) ファイルを参照してください。

## 商標について
このプロジェクトに記載されている商標は各社の商標です。