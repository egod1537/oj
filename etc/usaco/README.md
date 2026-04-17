# USACO crawler

`etc/usaco/crawl.js`는 `https://usaco.org/index.php?page=training`를 시작점으로 시즌, 대회 결과 페이지, 디비전별 문제 목록을 수집하는 Node.js 스크립트다. 메타데이터 JSON으로 저장할 수도 있고, QDUOJ 관리자 페이지에서 바로 넣을 수 있는 import ZIP으로도 내보낼 수 있다.

기본 실행:

```bash
node etc/usaco/crawl.js
```

TUI 실행:

```bash
node etc/usaco/crawl.js --tui
```

QDUOJ import ZIP 생성:

```bash
node etc/usaco/crawl.js --output-format qduoj --contest-limit 1 --output etc/usaco/usaco-qduoj-import.zip
```

QDUOJ import ZIP 생성 시 OI 룰 사용:

```bash
node etc/usaco/crawl.js --output-format qduoj --qduoj-rule-type OI --contest-limit 1 --output etc/usaco/usaco-qduoj-oi.zip
```

파일로 저장:

```bash
node etc/usaco/crawl.js --output etc/usaco/usaco-training.json
```

문제 본문까지 포함:

```bash
node etc/usaco/crawl.js --include-statements --output etc/usaco/usaco-training-full.json
```

빠르게 일부만 테스트:

```bash
node etc/usaco/crawl.js --season-limit 1 --contest-limit 2
```

QDUOJ export는 내부적으로 문제 지문과 공식 `test data` ZIP까지 내려받아서, QDUOJ 관리자 페이지의 `Import QDUOJ Problems (beta)`에 넣을 수 있는 ZIP 구조로 묶는다.

출력 JSON에는 대략 아래 정보가 들어간다.

- `resources`: training 페이지 상단의 관련 링크
- `seasons`: 시즌 목록
- `seasons[].contests[]`: 결과 페이지 링크와 상세 메타데이터
- `seasons[].contests[].divisions[]`: Platinum/Gold/Silver/Bronze 등 디비전 정보
- `seasons[].contests[].divisions[].problems[]`: 문제 제목, 문제 페이지 URL, `cpid`, 테스트 데이터 링크, 해설 링크
- `problemPage`: `--include-statements` 사용 시 문제 지문 HTML/텍스트

QDUOJ ZIP 출력 시에는 각 문제가 아래 구조로 패키징된다.

- `1/problem.json`
- `1/testcase/1.in`
- `1/testcase/1.out`
- `2/problem.json`
- `2/testcase/...`

별도 패키지 설치는 필요 없고, Node 18+ 이상이면 동작한다.

`--tui`를 사용하면 터미널 안에서 아래 옵션을 대화식으로 설정할 수 있다.

- 출력 형식(`metadata` / `qduoj`)
- 출력 경로
- 문제 본문 포함 여부
- QDUOJ rule type(`ACM` / `OI`)
- 시즌 제한
- 대회 제한
- 병렬 요청 수
- 시작 URL

전체 시즌을 한 번에 QDUOJ ZIP 하나로 만들면 용량이 매우 커질 수 있으니, 실제 업로드용 패키지는 `--season-limit` 또는 `--contest-limit`로 나눠서 생성하는 편이 안전하다.
