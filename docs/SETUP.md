# スマホ版のセットアップ

やることは3つ。**A → B → C の順**で進める。

---

## A. GitHub Pages で公開する

1. GitHub で新しいリポジトリを作る
   - 名前: `oald-vocab`
   - 公開設定: **Public**（無料アカウントの GitHub Pages は Public が必要）
2. このプロジェクトのフォルダごと push する
3. リポジトリの **Settings → Pages**
   - Source: **Deploy from a branch**
   - Branch: `main` / フォルダ: **`/docs`**
   - Save
4. 1〜2分待つと、ここで公開される

```
https://edy-hashiba.github.io/oald-vocab/
```

> 単語データはリポジトリに入らない（Drive と端末内にだけある）ので、Public でも
> 学習内容が他人に見えることはない。

---

## B. Google 側の設定

<https://console.cloud.google.com/> で作業する。

### B-1. プロジェクトを作る

画面上部のプロジェクト選択 → **新しいプロジェクト** → 名前 `OALD Vocab` → 作成。
作ったあと、そのプロジェクトが選択されていることを確認する。

### B-2. Drive API を有効にする

**APIs & Services → ライブラリ** → `Google Drive API` を検索 → **有効にする**。

### B-3. OAuth 同意画面

**APIs & Services → OAuth 同意画面**

| 項目 | 値 |
|---|---|
| User Type | **外部（External）** |
| アプリ名 | `OALD 単語帳` |
| ユーザーサポートメール | 自分の Gmail |
| デベロッパーの連絡先 | 自分の Gmail |

**スコープ**の画面で「スコープを追加または削除」→ 次を追加:

```
https://www.googleapis.com/auth/drive.file
```

これは**このアプリが作ったファイルしか見えない**最小権限。非機密スコープなので
Google の審査は不要。

最後に、状態を **「テスト中」から「本番環境」に公開** しておく。テスト中のままだと
定期的に承認をやり直すことになる。非機密スコープだけなので審査は入らない。

### B-4. クライアント ID を作る

**APIs & Services → 認証情報 → 認証情報を作成 → OAuth クライアント ID**

| 項目 | 値 |
|---|---|
| アプリケーションの種類 | **ウェブ アプリケーション** |
| 名前 | `OALD Vocab PWA` |
| 承認済みの JavaScript 生成元 | `https://edy-hashiba.github.io` |
| （ローカル検証用に追加） | `http://localhost:8803` |

**承認済みのリダイレクト URI は不要**（空のままでよい）。

作成すると `〜.apps.googleusercontent.com` という**クライアント ID** が出る。これをコピー。

> **クライアントシークレットは使わない。** ウェブページに置くと誰でも読めてしまう。
> コピーするのは ID だけ。

### B-5. config.js に貼る

`docs/config.js` を開いて 1 行だけ書き換える。

```js
CLIENT_ID: '1234567890-abcdefg.apps.googleusercontent.com',
```

保存して push する。クライアント ID は公開情報なので、Public リポジトリに
コミットして問題ない。

---

## C. スマホに入れる

1. スマホのブラウザで `https://edy-hashiba.github.io/oald-vocab/` を開く
2. **iPhone (Safari)**: 共有ボタン → **ホーム画面に追加**
   **Android (Chrome)**: メニュー → **アプリをインストール**
3. アプリを開いて **「同期」** をタップ → Google アカウントでサインイン
4. Drive に `oald-vocab.json` が作られる

以降、PC 側で単語を保存 → PC で同期 → スマホで同期、で単語が届く。

---

## 動作確認

| 確認 | 期待される結果 |
|---|---|
| PWA を開く | 上部の警告が消えている（CLIENT_ID 設定済み） |
| 「同期」をタップ | Google のサインイン画面 → 「同期しました」 |
| Drive を見る | マイドライブに `oald-vocab.json` がある |
| 機内モードで開く | アプリが起動し、6形式のクイズができる |

うまくいかないときは、ブラウザのコンソールに出るエラーを確認する。
`redirect_uri_mismatch` や `origin mismatch` が出る場合は、B-4 の
「承認済みの JavaScript 生成元」が公開 URL と一致していない。

---

## D. スマホから OALD の単語を保存する

同期ができたら、次はスマホでの保存。**ブックマークレット**を使う。

公開後、スマホで次のページを開いて、書いてある手順に従う。

```
https://edy-hashiba.github.io/oald-vocab/bookmarklet.html
```

iPhone は「ショートカット」方式（共有シートから2タップ）が快適。
Android は Chrome のブックマークをアドレスバーから呼び出す方式になる。

### 動くしくみ

ブックマークレット本体は約 150 バイトしかなく、`collect.js` を読み込むだけ。
パーサーを更新してもブックマークレットを入れ直す必要はない。

```
OALD の意味ページでブックマークレットを実行
   ↓  collect.js が読み込まれる
語義を選ぶパネルが出る（拡張機能のチェックボックスと同じ）
   ↓  「保存」
save.html に選んだ語義だけを渡す（URL の # 以降なのでサーバーには送られない）
   ↓
端末に保存 → Drive へ同期
```

### 制限

- 検索結果ページでは動かない（単語の意味ページで実行すること）
- 貼り付けたとき先頭の `javascript:` が消されることがある（手で足す）
