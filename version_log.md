## v10.9.0 功能版本 (2026-07-08) - Soft Trigger Skill：渐进披露 + 方法论 skill 机制

### 背景
借鉴 Claude Code 的渐进披露（Progressive Disclosure）架构，让方法论类 .md 技能通过 description 触发 + body 注入到 system prompt 的方式生效，取代原来只能作为 function call tool 的局限。

### 新增
- **Soft Trigger 机制（3 层渐进披露）**
  - Layer 1：所有 soft skill 的完整 description 进 system prompt（不截 30 字）
  - Layer 2：命中后 body 持续注入激活区，LLM 受约束执行
  - Layer 3：子文件按需加载（reference.md / examples.md）
- **SkillRegistry** 加 _triggerMode 字段，listSoftSkills() / isSoftTrigger() 方法
- **MDParser** 解析 frontmatter trigger_mode 字段
- **getToolSchemas()** 过滤 soft skill（避免双轨暴露）
- **systemPromptBuilder** 加 softSkillSection 参数
- **SoftSkillInjector** 触发/退激活/Layer 1+2+3 拼装
- **SubFileResolver** Layer 3 子文件加载（路径穿越防护）
- **UnifiedStrategy** 集成注入
- **create_skill** 重构：顶层分 type='tool'|'skill'，废弃旧 format 参数
- **skill-manager** list/info 返回 triggerMode 字段
- **SkillManager.jsx** 前添加"类型"列 + 创建弹窗 type/subType 选择

### 重写
- **concrete_innovation_brainstorm.md** — 修复文件名 BUG（连字符→下划线），改为 trigger_mode: soft，新增 Layer 3 子文件（reference.md / examples.md）

### 破坏性变更
- create_skill 参数 format 废弃，老调用返回 E_LEGACY_FORMAT，需改为 type/subType

### 测试
- 新增 7 个测试文件，约 400 行测试代码
- agent + skills 测试：32 suites / 320 tests 全绿

## v10.9.0 功能版本 (2026-07-08) - Soft Trigger Skill：渐进披露 + 方法论 skill 机制

### 背景
借鉴 Claude Code 的渐进披露（Progressive Disclosure）架构，让方法论类 .md 技能通过 description 触发 + body 注入到 system prompt 的方式生效，取代原来只能作为 function call tool 的局限。

### 新增
- **Soft Trigger 机制（3 层渐进披露）**
  - Layer 1：所有 soft skill 的完整 description 进 system prompt（不截 30 字）
  - Layer 2：命中后 body 持续注入激活区，LLM 受约束执行
  - Layer 3：子文件按需加载（reference.md / examples.md）
- **SkillRegistry** 加 `_triggerMode` 字段，`listSoftSkills()` / `isSoftTrigger()` 方法
- **MDParser** 解析 frontmatter `trigger_mode` 字段
- **getToolSchemas()** 过滤 soft skill（避免双轨暴露）
- **systemPromptBuilder** 加 `softSkillSection` 参数
- **SoftSkillInjector** 触发/退激活/Layer 1+2+3 拼装
- **SubFileResolver** Layer 3 子文件加载（路径穿越防护）
- **UnifiedStrategy** 集成注入
- **create_skill** 重构：顶层分 `type='tool'|'skill'`，废弃旧 `format` 参数
- **skill-manager** list/info 返回 `triggerMode` 字段
- **SkillManager.jsx** 前添加"类型"列 + 创建弹窗 type/subType 选择

### 重写
- **concrete_innovation_brainstorm.md** — 修复文件名 BUG（连字符→下划线），改为 `trigger_mode: soft`，新增 Layer 3 子文件（reference.md / examples.md）

### 破坏性变更
- create_skill 参数 `format` 废弃，老调用返回 `E_LEGACY_FORMAT`，需改为 `type/subType`

### 测试
- 新增 7 个测试文件，~400 行测试代码
- agent + skills 测试：32 suites / 320 tests 全绿

## v10.8.0 鍔熻兘鐗堟湰 (2026-07-08) - Todo 璁″垝瀹炴椂闈㈡澘锛氱敤鎴疯兘"鐪嬭" LLM 鍦ㄦ兂浠€涔?

### 鑳屾櫙
鑰佹澘鍙嶉锛?椤圭洰涓殑 todo 鎶€鑳界敤鎴峰畬鍏ㄧ湅涓嶅埌 LLM 璁″垝浜嗕粈涔堬紝鍙湅鍒?todo 鍦ㄨ窇锛岀敤鎴风湅涓嶈璁″垝鐨勮繘搴︼紝涔熺湅涓嶅埌鍏蜂綋浠€涔堣鍒掋€?

鍚庣 `todo_manage` Skill锛坴9.1.0锛夊疄鐜板畬鏁达紙6 绉?action + 鍐呭瓨瀛樺偍 + 浼氳瘽闅旂锛夛紝浣?*鍓嶇闆剁粍浠?*銆侺LM 璋?`todo_manage` 鏃讹紝缁撴灉鍙洖鍒?LLM 鑷繁锛屽墠绔敤鎴峰彧鑳戒粠 LLM 娴佸紡鏂囨湰閲岀寽锛屼綋楠屽樊銆?

### 鏂规
鏈€灏忔敼鍔?6 涓枃浠讹紙0 鍏煎浠ｇ爜锛夛細
- **鍚庣鎺ㄩ€?*锛歚todo-manage.js` 鍦?5 涓啓鎿嶄綔锛坈reate/add/update/complete/clear锛夊畬鎴愬悗锛岄€氳繃 `context.webContents.send('todo:updated', { sessionId, todos, total, completed })` 鎺ㄤ簨浠躲€俙list` 鍙涓嶆帹銆?
- **IPC 鍏滃簳**锛歔`src/main/ipcHandlers/agentHandler.js`](src/main/ipcHandlers/agentHandler.js) 鏂板 `ipcMain.handle('todo:list', ...)`锛屽鐢?skill 鐨?list action銆?
- **preload 鏆撮湶**锛歔`src/main/preload.js`](src/main/preload.js) 鏂板 `electronAPI.todo.{list, onUpdate, removeUpdateListener}`銆?
- **TodoPanel 缁勪欢**锛歔`src/renderer/components/TodoPanel.jsx`](src/renderer/components/TodoPanel.jsx) 鏂板缓锛氳繘搴︽潯 + 鍒楄〃锛堝畬鎴愭墦鍕俱€佽繘琛屼腑钃濋珮浜€佸緟鍔炵伆鐫€锛? 浼樺厛绾?Tag锛堥珮/涓?浣庯級銆?
- **闆嗘垚鑱婂ぉ椤?*锛歔`src/renderer/components/SmartDesignChat.jsx`](src/renderer/components/SmartDesignChat.jsx) 鍦?`StreamingAgentCard` 涓婃柟鎸?`<TodoPanel sessionId={state.session.currentId} />`锛屼粎瀵规鍦?streaming 鐨勬秷鎭寕杞姐€?

### 绔埌绔暟鎹祦
```
LLM 璋?todo_manage
  鈫?todo-manage.execute() 淇敼 _sessionTodos
  鈫?_notifyTodoUpdate(context, sessionId, todos) 鎺?todo:updated
  鈫?preload 鐨?todo.onUpdate 鍥炶皟
  鈫?TodoPanel setTodos 鈫?閲嶆覆鏌?
  鈫?鐢ㄦ埛鐪嬪埌闈㈡澘锛堣繘搴︽潯 + 鍒楄〃 + 鐘舵€佸彲瑙嗗寲锛?
```

鍏滃簳锛堥〉闈㈠埛鏂?/ 閲嶆柊鎸傝浇锛夛細
```
TodoPanel mount 鈫?todo.list(sessionId) 鈫?IPC todo:list 鈫?澶嶇敤 skill list action 杩斿洖娓呭崟
```

### 鍏抽敭璁捐
- **绌烘€佷笉娓叉煋**锛歚todos.length === 0` 鏃惰繑鍥?`null`锛堜笉鏄剧ず绌洪潰鏉匡級
- **sessionId 杩囨护**锛氬墠绔敹鍒颁簨浠跺悗鎸?`payload.sessionId === props.sessionId` 杩囨护锛屽拷鐣ュ叾浠?session 鐨勪簨浠?
- **闈欓粯瀹归敊**锛氬悗绔?`webContents` 涓嶅瓨鍦?宸查攢姣?`send` 鎶涢敊 鈥?鍏ㄩ儴 catch 鍚炴帀锛屼笉褰卞搷 skill 涓绘祦绋?
- **鎶樺彔鎬?*锛氭爣棰樻爮濮嬬粓鍙锛屽垪琛ㄥ彲鐐规姌鍙狅紝鎶樺彔鍚庡彧鍓?`馃搵 LLM 璁″垝 (2/5) + 杩涘害鏉
- **priority 涓枃鏍囩**锛歨igh/medium/low 娓叉煋涓?楂?涓?浣庯紝棰滆壊 red/orange/default

### 鏀瑰姩鏂囦欢
| 鏂囦欢 | 鏀瑰姩 |
|---|---|
| [`src/main/skills/todo-manage.js`](src/main/skills/todo-manage.js) | 鍔?`_notifyTodoUpdate` 宸ュ叿鍑芥暟 + 5 澶勫啓鎿嶄綔鎻掑叆鎺ㄩ€佽皟鐢?|
| [`src/main/ipcHandlers/agentHandler.js`](src/main/ipcHandlers/agentHandler.js) | 鏂板 IPC `todo:list`锛堝厹搴曟煡璇級 |
| [`src/main/preload.js`](src/main/preload.js) | 鏆撮湶 `todo.list` / `todo.onUpdate` / `todo.removeUpdateListener` |
| [`src/renderer/components/TodoPanel.jsx`](src/renderer/components/TodoPanel.jsx) | 鏂板缓锛堢害 160 琛岋級 |
| [`src/renderer/components/SmartDesignChat.jsx`](src/renderer/components/SmartDesignChat.jsx) | import + 1 琛?JSX 鎸傝浇 |
| [`src/main/__tests__/skills/todo-manage.test.js`](src/main/__tests__/skills/todo-manage.test.js) | 鏂板 9 涓帹閫佷簨浠舵祴璇?|
| [`tests/todoPanelSubscription.test.js`](tests/todoPanelSubscription.test.js) | 鏂板缓 8 涓暟鎹祦鍚堢害娴嬭瘯锛堟棤 jsdom 涔熻兘璺戯級 |

### 娴嬭瘯
- 鉁?`todo-manage.test.js` 42/42 鍏ㄧ豢锛?3 鏃?+ 9 鏂版帹閫佹祴璇曪級
- 鉁?`todoPanelSubscription.test.js` 8/8 鍏ㄧ豢锛坢ount 鎷夊彇 / sessionId 杩囨护 / unmount 娉ㄩ攢 / payload 褰㈢姸 / 澶氭鏇存柊 / 澶辫触瀹归敊锛?
- 鉁?鐩稿叧妯″潡鍥炲綊锛坅gentHandler / errorCodes / errorClassifier锛?2/73 鍏ㄧ豢锛? 涓?`abortBehavior` 娴嬭瘯鏄?pre-existing 澶辫触锛屼笌鏈鏀瑰姩鏃犲叧锛実it stash 楠岃瘉杩囷級

### 杈圭紭鎯呭喌瑕嗙洊
- LLM 娌¤皟 todo_manage 鈫?闈㈡澘涓嶆覆鏌?
- LLM 璋?create 鍚庣珛鍒?complete 鍏ㄩ儴 鈫?杩涘害鏉?100%锛屽垪琛ㄥ叏鎵撳嬀
- LLM 璋?clear 鈫?闈㈡澘娑堝け
- 鐢ㄦ埛鍒囦細璇?鈫?鏂?sessionId 閲嶆柊鎷夋竻鍗?
- 鐢ㄦ埛鍒锋柊椤甸潰 鈫?mount 鏃?`todo.list` 鎷夊厹搴曟暟鎹?
- webContents 宸查攢姣侊紙鍏抽棴涓級鈫?鎺ㄩ€侀潤榛樿烦杩?
- IPC 閫氶亾鏂?鈫?catch 鍚炴帀锛屼笉褰卞搷 skill 杩斿洖
- 浜嬩欢 payload.sessionId 涓嶅尮閰?鈫?鍓嶇蹇界暐
- 鍚屼竴 session 澶氭 update 鈫?浜嬩欢鎸夐『搴忚鐩栵紙鏈€鏂颁簨浠惰耽锛?

### 璁捐鏂囨。
- spec锛歔`docs/superpowers/specs/2026-07-08-todo-panel-design.md`](docs/superpowers/specs/2026-07-08-todo-panel-design.md)
- plan锛歔`docs/superpowers/plans/2026-07-08-todo-panel-plan.md`](docs/superpowers/plans/2026-07-08-todo-panel-plan.md)

### 鐗堟湰鍙峰悓姝ワ紙鎸?CLAUDE.md 瑙勫垯 7锛?
- 鉁?`package.json` version: 10.7.9 鈫?10.8.0
- 鉁?`package.json` build.output: `dist-10.7.9` 鈫?`dist-10.8.0`
- 鉁?[`src/renderer/pages/WorkspacePage.jsx:152`](src/renderer/pages/WorkspacePage.jsx#L152) `topbar-version`: v10.7.9 鈫?v10.8.0
- 鈿狅笍 main.js BrowserWindow 娌℃樉寮?setTitle锛堜緷璧?package.json `productName` = "鐮兼櫤"锛夛紝鏃犻渶鏀?
- 鈿狅笍 `index.html` `<title>` 鍐欐"鐮兼櫤"锛堟棤鐗堟湰鍙凤級锛屾棤闇€鏀?
- 鉁?grep 澶嶆煡 10.7.9 鍦ㄦ簮鐮佸尯宸叉棤鍖归厤锛堜粎鍓╂祴璇曟枃浠堕噷寮曠敤鍘嗗彶鍦烘櫙鐨勬敞閲婏紝涓嶅簲鏀癸級

### 鎵撳寘
鏈宸?`npm run electron:build` 鎵撳寘瀹屾垚锛?
- 杈撳嚭鐩綍锛歚dist-10.8.0/`
- `dist-10.8.0/鐮兼櫤 Setup 10.8.0.exe` 鈥?NSIS 瀹夎鐗堬紙**140M**锛岀害 145.9MB 鈫?140M锛屾瘮 v10.7.9 鐣ュ皬锛?
- `dist-10.8.0/鐮兼櫤-10.8.0-portable-x64.exe` 鈥?Portable 鍏嶅畨瑁呯増锛?*139M**锛?
- `dist-10.8.0/win-unpacked/` 鈥?鍏嶅畨瑁呰В鍘嬬洰褰?

vite 鎵撳寘鎻愮ず锛歐orkspacePage 鎷嗗嚭鐙珛 chunk 鍚庯紙`WorkspacePage-CNNmkUzL.js 2,322.17 kB`锛変粛瓒呰繃 500kB 璀﹀憡闃堝€硷紝鏄?echart/sequelize/sqlite3/xlsx 绛夐噸渚濊禆鐨勫浐鏈変綋绉紝涓嶅奖鍝嶅姛鑳姐€傚悗缁闇€浼樺寲鍙蛋 dynamic import 鎷?SettingsPage 鍐呯殑瀛愰〉闈紙寰呰€佹澘鎸囩ず锛夈€?

---

## v10.7.9 淇鐗堟湰 (2026-07-08) - 鍑忔按鍓傛幒閲?fmAdjustment 涓嶅簲鍙犲姞 strengthDosage 姊害

### 鑳屾櫙
鑰佹澘鍙嶉锛歷10.7.8 瀹炴祴 C30/C40/C50/C60 閰嶅悎姣旓紝finalDosage 姊害鏄?0.4%/10 寮哄害锛堜笉鏄?0.2%锛夈€?

鑰佹澘杩介棶锛?鐩爣缁嗗害妯℃暟鍙敤鏉ヨ绠楃爞鐨勬瘮渚嬶紱璁＄畻鐮傜殑澶栧姞鍓傚奖鍝嶇敤鐨勫疄闄呯粏搴︽ā鏁板摝"

### 鏍瑰洜
[`src/main/services/MixDesignService/MixDesignService_Aggregate.js:360`](src/main/services/MixDesignService/MixDesignService_Aggregate.js#L360) v10.7.7 鎶?`baseFinenessModulus` 鍐欐垚浜?`targetFinenessModulus`锛?

```js
const baseFinenessModulus = targetFinenessModulus  // 鈫?BUG
```

`targetFinenessModulus` 鏄?*寮哄害绛夌骇鐨勭洰鏍?*锛圕30=2.8, C40=3.0, C50=3.0, C60=3.2锛夈€?
`fmAdjustment = (targetFM - 鐮?FM) 脳 绯绘暟`锛屾墍浠ヨ法妗ｏ紙C30鈫扖40锛夋椂 fmAdjustment 璺熺潃鍙伴樁寮忓彉鍖栵細

| 绛夌骇 | targetFM | 鐮侳M=2.81 | fmAdjustment |
|:---:|:---:|:---:|:---:|
| C30 | 2.8 | 2.81 | -0.01 |
| C40 | 3.0 | 2.81 | +0.19 |
| C50 | 3.0 | 2.81 | +0.19 |
| C60 | 3.2 | 2.81 | +0.39 |

璺?strengthDosage 鐨?0.2%/10 寮哄害**鍙犲姞**锛屽鑷?finalDosage 姊害 = 0.4%/10 寮哄害銆?

### 鑰佹澘璇箟锛堟纭級
- `targetFinenessModulus` 鈫?鐢ㄦ潵璁＄畻鐮傜殑**姣斾緥**锛坄calculateOptimalFineAggregateRatio`锛?
- 澶栧姞鍓傛幒閲忕殑寰皟鍩哄噯 鈫?搴旇鏄敤鎴烽厤缃殑 `targetFinenessModulusBase`锛堥粯璁?2.7锛夛紝璺?[`MixDesignService_Database.js:160-162`](src/main/services/MixDesignService/MixDesignService_Database.js#L160) 閲岀殑 `baseFm` 涓€鑷?

### 鏀瑰姩锛堟渶灏?1 琛?+ 娉ㄩ噴锛?
[`MixDesignService_Aggregate.js:355-374`](src/main/services/MixDesignService/MixDesignService_Aggregate.js#L355)锛?

```js
// 淇锛坴10.7.9锛夛細鐢?tempSettings.targetFinenessModulusBase锛堥粯璁?2.7锛夊綋鍩哄噯
const baseFinenessModulus = parseFloat(tempSettings?.targetFinenessModulusBase) || 2.7
```

### 淇鍚庤涓?

| 绛夌骇 | strengthDosage | fmAdjustment锛堝熀鍑?2.7锛?| finalDosage | 宸?|
|:---:|:---:|:---:|:---:|:---:|
| C30 | 2.0% | (2.7-2.81)/0.1 脳 0.1 = -0.11 | 1.89 | 鈥?|
| C40 | 2.2% | -0.11锛堜笉鍙橈級 | 2.09 | +0.20 鉁?|
| C50 | 2.4% | -0.11 | 2.29 | +0.20 鉁?|
| C60 | 2.6% | -0.11 | 2.49 | +0.20 鉁?|

**finalDosage 姊害 = 0.2%/10 寮哄害**锛岃窡 strengthDosage 姊害涓€鑷达紝绗﹀悎 v10.7.7 璁捐鎰忓浘銆?

### 楠岃瘉
- 鉁?`superplasticizerDosage.test.js` 27/27 鍏ㄧ豢锛?4 鏃?+ 3 鏂帮級
  - 鍦烘櫙 F锛氬悇绾?strengthDosage 宸?0.2%/5寮哄害
  - 鍦烘櫙 G锛歠mAdjustment 涓嶈法寮哄害鍙樺寲锛堟牳蹇?bug 楠岃瘉锛?
  - 鍦烘櫙 H锛氱敤鎴锋樉寮忚鐩?base=2.8 鈫?fmAdjustment 鐩稿簲鏀瑰彉
- 鉁?`MixDesignOptimizer/MixDesignService_Database_Override/MixDesignService_Aggregate_Cement` 鍏ㄥ 62/62 鍏ㄧ豢
- 鉁?`verify-superplasticizer-rule-v2.js` 绔埌绔?24/24 閫氳繃

### 涓嶇牬鍧忕殑閮ㄥ垎
- `targetFinenessModulus` 浠嶇敤浜庣爞閰嶆瘮璁＄畻锛坄calculateOptimalFineAggregateRatio`锛?
- 鍑忔按鐜囧叕寮忎粛鐢?`strengthDosage`锛堜笉鍙?fmAdjustment 褰卞搷锛寁10.7.7 宸茶璁★級
- 鐢ㄦ埛鏄惧紡瑕嗙洊 `targetFinenessModulusBase` 浠嶇敓鏁堬紙鍦烘櫙 H 楠岃瘉锛?

### commit
- `511bd1d` fix(aggregate): fmAdjustment 鍩哄噯鐢?targetFinenessModulusBase锛堜笉鍙犲姞 strengthDosage 姊害锛?

### 鎵撳寘缁撴灉锛?026-07-08锛?
- 鎵撳寘鏃堕棿锛歷ite 10.86s + electron-builder ~3min锛屽叏杩囩▼ exit 0
- 杈撳嚭鐩綍锛歚dist-10.7.9/`
- 浜х墿锛?
  - `dist-10.7.9/鐮兼櫤 Setup 10.7.9.exe` 鈥?NSIS 瀹夎鐗堬紙**145.9 MB**锛?
  - `dist-10.7.9/鐮兼櫤-10.7.9-portable-x64.exe` 鈥?Portable 鍏嶅畨瑁呯増锛?*145.5 MB**锛?
  - `dist-10.7.9/win-unpacked/` 鈥?鍏嶅畨瑁呰В鍘嬬洰褰?

---

## v10.7.8 淇鐗堟湰 (2026-07-08) - JGJ55 skill 娓呯┖鍗曠偣鎺洪噺璧版淳鐢燂紙v10.7.7 鍗婃埅鍚屾鍏滃簳锛?

### 鑳屾櫙
v10.7.7 鏀?schema/DEFAULTS 璁╁崟鐐规幒閲?涓嶅～璧版淳鐢?锛?*浣嗗啓鍏ヨ矾寰勬病鏀?*鈥斺€旇€佹澘 DB 閲屾湁鍘嗗彶鍗曠偣瑕嗙洊鍊硷紙`superplasticizerDosage_C40 = 2.9`锛岄攤娓ｄ笓鐢ㄥ鍔犲墏鏃朵唬閬楃暀锛夛紝AI 鎯虫竻绌鸿蛋娲剧敓鏃朵笁涓敊璇矾寰勫叏姝伙紙璇﹁涓嬫柟"鏁呴殰閾?锛夈€?

### 鏁呴殰閾撅紙chat_history ID 1673~1681 鍙嶆煡锛?
1. 鉂?`update_jgj55_param(value=null)` 鈫?`PARAM_MISSING`锛坴alue 蹇呭～锛?
2. 鉂?`batch_update_jgj55_params(params=...)` 鈫?`PARAM_MISSING`锛堝弬鏁板悕閿欎簡锛屾槸 `updates` 涓嶆槸 `params`锛?
3. 鉂?`batch_update_jgj55_params(updates=[{value:""}])` 鈫?`OUT_OF_RANGE`锛堢┖涓?coerce 鎴?0锛岃繚鍙?min=1锛?
- 3 娆″け璐ワ紝AI 娌￠€€璺紝浼氳瘽鍋滀簡锛宐ug 鐣欏湪 DB 閲岃嚦浠?

### 鏍瑰洜
JGJ55 skill 鐨?璇?璇箟鏀逛簡锛坰chema 鎻忚堪"涓嶅～=娲剧敓"锛夛紝**"鍐?璺緞娌″姩**鈥斺€擿validateValue` 涓嶆帴鍙?null/绌轰覆锛宍update_jgj55_param` 鐨?`value` 浠?`required: true`銆?

### 鏀瑰姩锛堟渶灏忥級
1. **`validateValue`**锛坄src/main/skills/jgj55-params.js` 60-71 琛岋級锛氬姞 null/绌轰覆/鏈畾涔夊垎鏀?鈫?杩斿洖 `{ ok: true, value: null }`锛堣涔夛細娓呯┖锛?
2. **`update_jgj55_param`**锛氬幓鎺?`required: ['name','value']`锛屾敼涓?`required: ['name']`锛泇alue 鍏佽 null锛沞xecute 涓?value===null 璧?`deleteParam` 鑰岄潪 `setParam`锛堥伩鍏?`String(null)="null"` 鍐欒繘 DB锛?
3. **鏂板 `clear_jgj55_param(name)` skill**锛氫笓闂ㄦ竻鍗曚釜鍙傛暟璧伴粯璁?娲剧敓
4. **`batch_update_jgj55_params`**锛氬鐢ㄦ柊 validateValue锛寁alue===null 璧?deleteParam
5. **閰嶅娴嬭瘯**锛坄src/main/__tests__/skills/jgj55-params.test.js`锛夛細8 涓柊 case 瑕嗙洊鎵€鏈夋竻绌鸿矾寰?

### 楠岃瘉
- 鉁?`jgj55-params.test.js` 18/18 鍏ㄧ豢锛?0 涓師鏈?+ 8 涓柊锛?
- 鉁?`verify-superplasticizer-rule-v2.js` 绔埌绔?24/24 閫氳繃
- 鉁?git stash 楠岃瘉锛?8 涓?pre-existing 澶辫触锛坵orkspace/LearningService/WikiEngine/snapshot锛夊拰鏈慨澶嶆棤鍏?

### 鐜板満娓呯悊锛堣€佹澘鎵嬪姩锛?
鏂拌鐨?v10.7.8 鍚庯紝鑰佹澘鍙互閫変竴绉嶆柟寮忔竻鎺夊巻鍙茶剰鏁版嵁 `superplasticizerDosage_C40 = 2.9`锛?
1. **app 鍐?*锛?绯荤粺璁剧疆 鈫?JGJ55 鍙傛暟 鈫?鍑忔按鍓傛幒閲?鈥?C40" 娓呯┖瀹?
2. **璋冩柊 skill**锛欰I 鍔╃悊璋?`clear_jgj55_param({name: "superplasticizerDosage_C40"})`
3. **DB 鐩存竻**锛歚DELETE FROM systemParams WHERE paramName='superplasticizerDosage_C40';`

娓呮帀鍚?C40 娲剧敓 = 2.0 + (40-30)/5脳0.1 = **2.2%**锛堜笉鍐?2.79%锛?

### 涓嶇牬鍧忕殑閮ㄥ垎
- 鍘熸湁 5 浠跺 skill 瀹屽叏鍏煎锛坰chema 鎻忚堪鏇存柊銆乣value` 浠嶆帴鍙楁暟瀛楋級
- v10.7.7 鐨?鍗曠偣 > 娲剧敓"浼樺厛绾ч€昏緫涓嶅彉
- 绔埌绔?24 涓?case 鍏ㄩ儴閫氳繃

### commit
- `b74b75f` fix(jgj55-skill): 鏀寔娓呯┖鍗曠偣鎺洪噺璧伴粯璁?娲剧敓锛坴10.7.7 鍗婃埅鍚屾鍏滃簳锛?

### 鎵撳寘缁撴灉锛?026-07-08锛?
- 鎵撳寘鏃堕棿锛歷ite 10.82s + electron-builder ~3min锛屽叏杩囩▼ exit 0
- 杈撳嚭鐩綍锛歚dist-10.7.8/`
- 浜х墿锛?
  - `dist-10.7.8/鐮兼櫤 Setup 10.7.8.exe` 鈥?NSIS 瀹夎鐗堬紙**145.9 MB**锛?
  - `dist-10.7.8/鐮兼櫤-10.7.8-portable-x64.exe` 鈥?Portable 鍏嶅畨瑁呯増锛?*145.5 MB**锛?
  - `dist-10.7.8/win-unpacked/` 鈥?鍏嶅畨瑁呰В鍘嬬洰褰?
- 骞冲彴锛歐indows x64锛圢SIS + portable锛?
- Node/Electron锛歟lectron@28.3.3
- electron-builder锛?4.13.3

---

## v10.7.7 (2026-07-08) - 鍑忔按鍓傛幒閲忔柊瑙勫垯锛堝熀鍑?娲剧敓锛?+ 鏍囬鏍忕増鏈彿鍚屾

### 鎵撳寘缁撴灉锛?026-07-08锛?
- 鎵撳寘鏃堕棿锛歷11.24s锛坴ite build锛?+ ~3min锛坋lectron-builder锛?
- 杈撳嚭鐩綍锛歚dist-10.7.7/`
- 浜х墿锛?
  - `dist-10.7.7/鐮兼櫤 Setup 10.7.7.exe` 鈥?NSIS 瀹夎鐗堬紙**140 MB**锛?
  - `dist-10.7.7/鐮兼櫤-10.7.7-portable-x64.exe` 鈥?Portable 鍏嶅畨瑁呯増锛?*139 MB**锛?
  - `dist-10.7.7/win-unpacked/` 鈥?鍏嶅畨瑁呰В鍘嬬洰褰?
- 骞冲彴锛歐indows x64锛圢SIS + portable锛?
- Node/Electron锛歟lectron@28.3.3
- electron-builder锛?4.13.3

### 鏍囬鏍忕増鏈彿鍚屾锛堣€佹澘 2026-07-08 寮鸿皟锛?
- 淇鐐癸細[`src/renderer/pages/WorkspacePage.jsx:152`](src/renderer/pages/WorkspacePage.jsx#L152) `topbar-version` 鍐欐 v9.0.0锛堣惤鍚庡涓増鏈級鈫?鏀?v10.7.7
- 鍚屾鍔犺繘 CLAUDE.md 绗?7 鏉¤鍒欙紙"鐗堟湰鍙峰悓姝?锛?
- 鎵弿纭锛欻TML title 鏍囩鍜?BrowserWindow title 閮芥病鏈夌増鏈彿纭紪鐮侊紙HTML title 鏄?鐮兼櫤"绾枃瀛楋紝BrowserWindow 鐢?`titleBarStyle: 'hidden'` 璧拌嚜瀹氫箟 topbar锛夛紝鎵€浠ュ彧鏀硅繖涓€澶?
- 鍏朵粬 v\d+\.\d+\.\d+ 鍖归厤椤瑰潎涓轰唬鐮佹敞閲婁腑鐨勫巻鍙茬増鏈彿锛屼笉褰卞搷鐢ㄦ埛

### 鑰佹澘 2026-07-08 鍐崇瓥

### 鑰佹澘 2026-07-08 鍐崇瓥
鏇挎崲鏃ц鍒欙紙姣忎釜寮哄害绛夌骇鐙珛纭紪鐮侀粯璁ゅ€?1.6%-2.2%锛夈€傛柊瑙勫垯鏍稿績锛?

- **C30 鍩哄噯鎺洪噺** = 鍑忔按鍓傛潗鏂?`recommendedDosage`锛堝厹搴?1.8%锛?
- **绛夌骇鎺洪噺**锛氱敤鎴峰崟鐐规寚瀹?> 浠?C30 鍩哄噯娲剧敓锛埪?.1%/5寮哄害锛?
- **鍑忔按鐜囧叕寮?*锛歚waterReducingRate + (strengthDosage - 鏉愭枡鎺ㄨ崘) / 0.1 脳 waterReducingRatePer01Dosage`
- **鐮傜煶 MB/缁嗗害妯℃暟 寰皟浜х敓鐨勬幒閲忓彉鍖栦笉褰卞搷鍑忔按鐜?*锛堣€佹澘瑙勫垯锛?
- **娌￠€夊噺姘村墏鏉愭枡** 鈫?鎺洪噺=0, 鍑忔按鐜?0, 鐢ㄦ按閲忎笉淇

### 涓変釜鐙珛姒傚康锛堜笉瑕佹贩锛?
| 姒傚康 | 鏉ユ簮 | 浣滅敤 |
|------|------|------|
| 鏉愭枡鎺ㄨ崘鎺洪噺 | `Material.recommendedDosage` | 鍑忔按鐜囧叕寮忕殑"鍩哄噯"锛堝巶瀹舵爣瀹氾級 |
| C30 鍩哄噯鎺洪噺 | 浼樺厛绾? 鐢ㄦ埛瑕嗙洊 > 鏉愭枡鎺ㄨ崘 > 1.8% 鍏滃簳 | 鍐冲畾 C20-C50 娲剧敓 |
| 鍚勭瓑绾т娇鐢ㄦ幒閲?| 鐢ㄦ埛鍗曠偣 > C30 鍩哄噯 / 娲剧敓鍏紡 | 閰嶅悎姣斿疄闄呯敤 |

### 娑夊強 8 涓枃浠舵敼鍔?
1. `src/main/services/MixDesignService/MixDesignService_WaterRatio.js` 鈥?鏂板 `getC30Baseline`锛岄噸鍐?`getSuperplasticizerDosageByStrength` 閫忎紶鏉愭枡
2. `src/main/services/MixDesignService/MixDesignService_Aggregate.js` 鈥?閫忎紶鏉愭枡 + 娌￠€夋潗鏂欑煭璺?+ 鍑忔按鐜囧叕寮忔敼鐢?`strengthDosage`锛堜笉鍚爞鐭冲井璋冿級
3. `src/main/services/MixDesignService/MixDesignService_Database.js` 鈥?涓绘祦绋嬮€忎紶 + 娌￠€夋潗鏂欐椂鍑忔按鐜?0
4. `src/main/services/MixDesignService/index.js` 鈥?facade 閫忎紶
5. `src/main/services/MixDesignOptimizer.js` 鈥?闃舵 2-4 閫忎紶 `defaultSp`
6. `src/main/services/SystemService.js` 鈥?榛樿绉嶅瓙琛ㄦ洿鏂帮紙鍒?6 涓姞 1 涓熀鍑嗭級
7. `src/main/skills/jgj55-params.js` 鈥?schema + DEFAULTS 鍚屾
8. `src/renderer/config/paramConfig.js` 鈥?UI 鏍囩鍖哄垎鍩哄噯/鍗曠偣/娲剧敓
9. `src/renderer/main.jsx` 鈥?娴忚鍣ㄥ鍒荤増鍚屾

### 鏂板 3 涓枃浠?
- `src/main/services/MixDesignService/__tests__/superplasticizerDosage.test.js` 鈥?24 涓崟鍏冩祴璇?
- `tests/manual/verify-superplasticizer-rule-v2.js` 鈥?绔埌绔獙璇佽剼鏈紙6 涓湡瀹炲満鏅紝24 涓柇瑷€锛?
- `docs/superpowers/specs/2026-07-08-superplasticizer-dosage-rule-v2.md` 鈥?鏂拌鍒欒鏄?

### 鍚屾鏇存柊鐨?spec/plan
- `docs/superpowers/specs/2026-07-04-jgj55-skill-and-settings-cleanup-spec.md` 鈥?鍙傛暟琛?+ DEFAULTS
- `docs/superpowers/specs/2026-07-04-cost-optimizer-v2-design.md` 鈥?鍑芥暟绛惧悕
- `docs/superpowers/plans/2026-05-08-code-structure-refactor-implementation.md` 鈥?API 琛?

### 楠岃瘉
- 鉁?鍗曞厓娴嬭瘯 24/24 閫氳繃
- 鉁?绔埌绔獙璇?24/24 閫氳繃
- 鉁?鐜版湁 MixDesignService 娴嬭瘯 63/63 閫氳繃锛堟棤鐮村潖锛?

### 琛屼负鍙樺寲锛堢牬鍧忔€э級
- 璋?C30 鍩哄噯杩囧幓鍙奖鍝?C30 鈫?鐜板湪褰卞搷**鍏ㄩ儴娲剧敓绛夌骇**锛圕20-C50锛?
- 鍑忔按鐜囧叕寮忕敤 `strengthDosage`锛堜笉鍚爞鐭冲井璋冿級锛屼笉鍐嶇敤 `finalDosage`
- 娌￠€夊噺姘村墏鏉愭枡 鈫?鏁存楠ょ煭璺紙鎺洪噺=0, 鍑忔按鐜?0锛?
- 鍑芥暟绛惧悕鍙樻洿锛歚getSuperplasticizerDosageByStrength(strength, superplasticizerMaterial, tempSettings)`銆乣calculateSuperplasticizerDosage(strength, fineAggregateMaterial, superplasticizerMaterial, tempSettings)` 绛?

### 涓嶇牬鍧忕殑閮ㄥ垎
- 宸插瓨鍦?DB 閲岀殑瀛橀噺鐢ㄦ埛鎺洪噺鍊间粛鐒剁敓鏁堬紙鍚戝悗鍏煎锛?
- `Material.waterReducingRatePer01Dosage` 瀛楁宸插瓨鍦紙榛樿 2.0锛夛紝鏂拌鍒欑洿鎺ョ敤

### commit
- `73f5221` feat(閰嶅悎姣?: 鍑忔按鍓傛幒閲忔柊瑙勫垯锛堝熀鍑?娲剧敓锛?

---



### 鑰佹澘浜屾鍙嶉鎵撹劯锛坴10.7.6 绗竴鐗堜慨澶嶅け鏁堬級
鑰佹澘鍙嶆槧锛?鎴戣浜?v10.7.6锛屼粛鐒剁粰鎴戝姞鍏ラ攤娓?20%銆? 绔嬪埢 grep 楠岃瘉涓绘祦绋嬶細

- `_firstLayerFilter` 鍦?[MixDesignOptimizer.js:750](src/main/services/MixDesignOptimizer.js#L750) **娌′汉璋冪敤**鈥斺€斿鍎垮嚱鏁?
- 鐪熸鐨?task 鐢熸垚鍦?[_stage2Filter @ 677-698](src/main/services/MixDesignOptimizer.js#L677-L698) 鈥?**鍚屾牱鐨?bug 娌′慨锛?*
- 涓绘祦绋嬶細`optimizeMixDesign` 鈫?`_stage2Filter` 鈫?`_stage3Refine` 鈫?...

### v10.7.6 绗簩鐗堜慨澶?
- [_stage2Filter @ 685 鍚嶿(src/main/services/MixDesignOptimizer.js#L685-L691) 鍔犲悓鏍风殑杩囨护锛?
  ```js
  if ((flyAsh > 0 && !flyAshMat) ||
      (slag > 0 && !slagMat) ||
      (lithiumSlag > 0 && !lithiumSlagMat) ||
      (compositePowder > 0 && !compositePowderMat)) continue
  ```
- 鍚屾缁?[_firstLayerFilter](src/main/services/MixDesignOptimizer.js#L813-L820) 鍔犲悓鏍疯繃婊わ紙瀛ゅ効鍑芥暟涔熶慨锛岄伩鍏嶆湭鏉ヨ皟鐢ㄨ€呰俯鍚屾牱鐨勯浄锛?
- 娴嬭瘯 [MixDesignOptimizer_EmptyAdmixture.test.js](src/main/__tests__/services/MixDesignOptimizer_EmptyAdmixture.test.js) 鏂板 _stage2Filter 鐢ㄤ緥锛堣鐩栦富娴佺▼鍏ュ彛锛夛紝鍘熸湁 2 涓敤渚嬩粛鏈夋晥
- **services + skills 鍏ㄥ 270/270 鍏ㄧ豢**
- 鑰佹澘涔嬪墠鐪嬪埌鐨?workspace/LearningService 澶辫触鏄?*棰勫瓨鐨勶紝涓庢湰淇鏃犲叧**锛堝凡閫氳繃 git stash 鍦?master 涓婂鐜扮‘璁わ級

### 杩欐鐨勫弽鎬?
- **娴嬭瘯瑕佸湪涓绘祦绋嬪叆鍙ｅ啓锛岃€屼笉鏄湪瀛ゅ効鍑芥暟涓?*锛歘firstLayerFilter 娌¤璋冪敤锛屽啓 100 涓祴璇曚篃鏁戜笉浜?v10.7.6 绗竴鐗堣€佹澘鐪嬪埌鐨勭幇鍦?
- **patch 涔嬪墠鍏?grep 楠岃瘉鍑芥暟鏄惁琚皟鐢?*鈥斺€斾竴鍙ヨ瘽灏辫兘閬垮厤杩欑"patch 鍦ㄩ敊鍦版柟"鐨勪簨鏁?

### 鎵撳寘
- `dist-10.7.6/鐮兼櫤 Setup 10.7.6.exe` 鈥?NSIS 瀹夎鐗?
- `dist-10.7.6/鐮兼櫤-10.7.6-portable-x64.exe` 鈥?渚挎惡鐗?
- 鎵撳寘鑰楁椂锛歷ite 13.40s + electron-builder ~5min锛屽叏绋?exit 0

---

## v10.7.6 淇鐗堟湰 (2026-07-07) - 绌烘幒鍚堟枡"骞界伒鐢ㄩ噺" bug锛堣€佹澘瀹炴祴鍙嶉锛? JGJ55 鍑忔按鍓備笂闄愭墿澶?

### 鎵撳寘
- `dist-10.7.6/鐮兼櫤 Setup 10.7.6.exe` 鈥?NSIS 瀹夎鐗堬紙145.9 MB锛?
- `dist-10.7.6/鐮兼櫤-10.7.6-portable-x64.exe` 鈥?渚挎惡鐗堬紙145.5 MB锛?
- 鎵撳寘鑰楁椂锛歷ite 11.81s + electron-builder ~5min锛屽叏杩囩▼ exit 0
- commit 淇℃伅锛歚chore: 鍗囩増 v10.7.6锛圝GJ55 鍑忔按鍓備笂闄愭墿澶?+ 绌烘幒鍚堟枡骞界伒鐢ㄩ噺 bug 淇锛塦

---

## v10.7.6 淇鐗堟湰 (2026-07-07) - 绌烘幒鍚堟枡"骞界伒鐢ㄩ噺" bug锛堣€佹澘瀹炴祴鍙嶉锛?

### 鑳屾櫙
鑰佹澘璋?`optimize_mix_cost`锛?*娌′紶 `lithiumSlagIds`**锛堢敋鑷虫樉寮忎紶 `[]`锛夛紝浣?`bestSolution.materials.lithiumSlag` 浠嶄骇鍑?50.14 kg 閿傛福銆侫I 鍦ㄥ璇濋噷**璇氬疄**鍦拌"鎴戞病浼?锛?*鑰佹澘鏈€鍒濇€€鐤?AI 鎾掕皫**銆?

### 鐪熷亣楠岃瘉锛堢敤鑰佹澘鐪熷疄 DB 鍙嶆煡 tool_calls锛?
鍘?`C:/Users/sunys/AppData/Roaming/concrete-mixdesign/concrete-mixdesign.db` 鐨?`chat_history.toolCalls` JSON 鍒楀弽鏌?`session-1783427576610-n01o`锛?

| AI 瀹為檯浼犵殑 `lithiumSlagIds` | 缁撴灉 lithiumSlag (kg) |
|------------------------------|----------------------|
| `[84]` | 50.14锛堢悊搴旓級 |
| **鏃犲瓧娈?* | **50.14** 鈿狅笍 |
| **`[]`**锛堟樉寮忕┖鏁扮粍锛?| **50.14** 鈿狅笍鈿狅笍 |

**AI 娌℃拻璋?*锛屾槸 skill/optimizer 鐨勪唬鐮?bug銆?

### 鏍瑰洜锛堝弻灞傛紡娲炲彔鍔狅級
1. **[src/main/services/MixDesignOptimizer.js:807-815](src/main/services/MixDesignOptimizer.js#L807-L815)** 浠诲姟鐢熸垚寰幆 `_firstLayerFilter`锛?
   - `_getMaterialList([])` 杩斿洖 `[null]`锛堣璁′笂 material 绌烘椂鏍?null锛?
   - 浣嗗唴灞傛幒閲忓惊鐜?`for (const lithiumSlag of _lr)` 浠嶇劧鏋氫妇 [0, 5, 10, 15, 20]
   - **`(mat===null && dosage>0)` 鐨勭粍鍚堢収鏍疯 push 杩?tasks**

2. **[src/main/services/MixDesignService/MixDesignService_Database.js:391](src/main/services/MixDesignService/MixDesignService_Database.js#L391)** 鐢ㄩ噺璁＄畻锛?
   ```js
   lithiumSlag: cementitiousAmount * lithiumSlagPercentage,
   ```
   鍙敤鎺洪噺鐧惧垎姣旓紝**瀹屽叏涓嶆牎楠?`materials.lithiumSlag` 鏄惁涓烘湁鏁堝璞?*鈥斺€旀墍浠?null 鏉愭枡 + 5% 鎺洪噺锛岀収鏍风畻鍑洪潪 0 kg銆?

### 淇锛堟渶灏忔敼鍔級
鍦?[src/main/services/MixDesignOptimizer.js:813-820](src/main/services/MixDesignOptimizer.js#L813-L820) 鍔犱竴琛岃繃婊わ細

```js
// 淇锛坴10.7.6锛夛細鎺哄悎鏂欐潗鏂欎负 null 浣嗘幒閲?> 0 鏃惰烦杩囪浠诲姟
if ((flyAsh > 0 && !flyAshMat) ||
    (slag > 0 && !slagMat) ||
    (lithiumSlag > 0 && !lithiumSlagMat) ||
    (compositePowder > 0 && !compositePowderMat)) continue
```

**涓轰粈涔堜慨鍦?task 鐢熸垚灞傝€岄潪 calculator 灞?*锛?
- 涓€澶勪慨澶嶈鐩?4 绫绘幒鍚堟枡
- 璺宠繃鐨勬槸 task 鑰屼笉鏄薄鏌撶粨鏋溾€斺€斾笉娴垂涓嬫父璁＄畻
- 鏁版嵁搴撲晶涓嶉渶鍔紙鍏朵笟鍔￠€昏緫"鍙寜鎺洪噺绠楃敤閲?鏄悎鐞嗙殑锛宯ull 妫€鏌ュ簲璇ュ彂鐢熷湪 optimizer 杈圭晫锛?

### 楠岃瘉
- **鏂板 [src/main/__tests__/services/MixDesignOptimizer_EmptyAdmixture.test.js](src/main/__tests__/services/MixDesignOptimizer_EmptyAdmixture.test.js)**锛?
  - 娴嬭瘯 1锛氭湭浼?lithiumSlag 鏃讹紝bestSolution 涓嶅簲鍚?lithiumSlag > 0 鈥?淇鍓?*绾㈢伅**锛?0.37kg 姹℃煋锛夛紝淇鍚?*缁跨伅**
  - 娴嬭瘯 2锛氭湭浼?flyAsh/slag 鏃跺悓鐞?鈥?瑕嗙洊鍚屼竴淇璺緞
- **鍥炲綊**锛歴ervices + skills 鍏ㄥ **269/269 鍏ㄧ豢**锛?3 涓?test suite锛? snapshots

### 鑰佹澘鐨勫弽鎬濇暀璁紙宸插姞鍏ユ垜鐨勪笉鍐嶇姱璁″垝锛?
1. 鍚庣画鍐嶉亣鍒?AI 璇?vs 浠ｇ爜鍋?鍐茬獊鏃讹紝**鍏堝幓 DB 鍙嶆煡 `chat_history.toolCalls`** 鈥斺€?AI 鐨?鎴戞病鍋?鑷檲**姘歌繙涓嶈兘褰撲簨瀹炰緷鎹?*
2. task generation 灞傛槸**鏈€瀹规槗婕忔牎楠岀殑"杈圭晫"**鈥斺€旀墍鏈変粠鐢ㄦ埛杈撳叆/DB 鏌ヨ鏄犲皠鍒板唴閮ㄦ暟鎹粨鏋勭殑鍦版柟锛岄兘瑕侀棶"浠€涔堟槸绌猴紵"鑰屼笉鏄亣璁炬湁鍊?

---

## v10.7.5 璋冩暣鐗堟湰 (2026-07-07) - JGJ55 鍑忔按鍓傛幒閲忎笂闄愭墿澶?2.5% 鈫?5.0%

### 鑳屾櫙
鑰佹澘鍙嶉锛氱郴缁熻缃腑 JGJ55 鏍囧噯闄愬埗浜嗗悇绛夌骇娣峰嚌鍦熷噺姘村墏鎺ㄨ崘鎺洪噺鐨勪笂涓嬮檺锛?.0-2.5%锛夛紝鑼冨洿杩囧皬锛屾棤娉曟弧瓒抽珮鍑忔按鐜囧満鏅€?

### 鍙樻洿鍐呭
**浠呮墿澶т笂闄愶紝涓嶅姩涓嬮檺鍜岄粯璁ゅ€?*锛堜笉鐮村潖瀛橀噺鏁版嵁锛夛細

| 鏂囦欢 | 椤?| 鍙樻洿 |
|------|-----|------|
| `src/renderer/config/paramConfig.js` | `superplasticizerDosage_C20` ~ `C50`锛? 椤癸級 | `max: 2.5` 鈫?`max: 5.0` |
| `src/main/skills/jgj55-params.js` | `JGJ55_SCHEMA.superplasticizerDosage_C20` ~ `C50`锛? 椤癸級 | `max: 2.5` 鈫?`max: 5.0` |

### 涓轰粈涔堟敼涓や釜鏂囦欢
- `paramConfig.js` 鏄?ESM锛屽墠绔覆鏌撹缃〉闈㈢敤
- `jgj55-params.js` 鏄?CommonJS 鍐呰仈鍓湰锛宎gent skill 鏍￠獙鍙傛暟鑼冨洿鐢?
- 涓や唤鐙珛缁存姢锛屽繀椤诲悓姝ユ敼锛氬惁鍒欏墠绔兘鎷栧埌 5%锛孉I 鏍￠獙閭ｈ竟浼氳 OUT_OF_RANGE 鎵撳洖

### 涓嶅姩鐨勯儴鍒?
- 榛樿鍊?1.6-2.2% 淇濇寔涓嶅彉
- `waterReducingRatePer01Dosage` 鑼冨洿 0.5-2.5% 涓嶅姩锛堢嫭绔嬪弬鏁帮紝涓庢幒閲忎笂闄愭棤鐩存帴鑱斿姩锛?
- 宸插瓨鍌ㄥ湪 DB 閲岀殑瀛橀噺鐢ㄦ埛鍊间笉琚鐩栵紙`setParam` 鍙湪鐢ㄦ埛涓诲姩鎷栧姩鏃跺啓锛?

### 楠岃瘉
- 涓や釜鏂囦欢涓墍鏈?7 椤癸紙C20-C50锛夊潎 `min: 1.0, max: 5.0, step: 0.1` 鉁?
- `waterReducingRatePer01Dosage` 浠嶆槸 `max: 2.5`锛堟湭琚鏀癸級鉁?
- `jgj55-params.test.js` 浠呮寜鍙傛暟鍚嶆煡 schema锛屼笉渚濊禆鍏蜂綋鑼冨洿鍊硷紝鏃犻渶鏇存柊

### 鍘嗗彶褰掓。
鏈枃浠跺洜瓒呰繃 1000 琛岋紙宸茶揪 7445 琛岋級锛屾寜 CLAUDE.md 绗?5 鏉¤鍒欏綊妗ｆ棫鏃ュ織涓?`version_log_20260707.md`銆?

---


### 打包记录 (v10.9.0)
- dist-10.9.0/砼智 Setup 10.9.0.exe (140 MB, NSIS 安装包)
- dist-10.9.0/砼智-10.9.0-portable-x64.exe (139 MB, 便携版)
- 15 commits since v10.8.0