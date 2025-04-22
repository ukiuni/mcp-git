import { spawn, exec } from 'child_process';
import * as os from 'os'; // os モジュールをインポート
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    type Tool,
    type CallToolResult, // Changed from CallToolResponse
    type ListToolsResult, // Changed from ListToolsResponse
    type Request as McpRequest, // Renamed Request to McpRequest for clarity
    // type Response as McpResponse, // Response type does not exist, removed
    type ToolSchema, // Changed from ToolInputSchema
} from '@modelcontextprotocol/sdk/types.js';

interface GitCommand {
    name: string; // e.g., "git-add"
    command: string; // e.g., "add"
    description: string;
}
// git help -a の出力を解析してコマンドリストを取得する関数
async function getGitCommands(): Promise<GitCommand[]> {
    return new Promise((resolve, reject) => {
        // OS を判定して git コマンド名を決定
        const gitCommand = os.platform() === 'win32' ? 'git.exe' : 'git';
        // 決定したコマンド名を使用
        const gitHelp = spawn(gitCommand, ['help', '-a']);
        let output = '';
        let errorOutput = '';

        gitHelp.stdout.on('data', (data) => {
            output += data.toString();
        });

        gitHelp.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        gitHelp.on('close', (code) => {
            if (code !== 0) {
                console.error(`git help -a failed with code ${code}: ${errorOutput}`);
                // エラーが発生しても、基本的なコマンドリストを返すフォールバックも検討可能
                // ここでは基本的なコマンドを手動で定義する例を示す
                reject("Falling back to a predefined list of basic Git commands.");
                return;
            }

            const commands: GitCommand[] = [];
            const lines = output.split('\n');
            // 正規表現: 行頭の空白 + コマンド名 + 1つ以上の空白 + 説明
            // git help -a の出力形式が変わる可能性を考慮し、より堅牢なパースが必要になる場合がある
            const commandRegex = /^\s{3,}([a-zA-Z0-9._-]+)\s+(.*)$/; // . や _ を含むコマンド名に対応

            let inCommandsSection = false; // コマンドリストセクション内にいるかどうかのフラグ

            for (const line of lines) {
                 // 'available git commands' のようなセクション開始行を探す
                 // または、特定のヘッダー行 ("Main Porcelain Commands" など) を検出する
                 if (line.match(/available git commands/i) || line.match(/Main Porcelain Commands/i) || line.match(/Low-level Commands/i)) {
                    inCommandsSection = true;
                    continue;
                }
                // 空行や別のセクションヘッダーでコマンドセクションの終わりを検出
                if (inCommandsSection && (!line.trim() || (line.trim() && !line.startsWith(' ')))) {
                    // 'See also' の行などでセクションが終わる場合もある
                    if (!line.includes('See also')) {
                         inCommandsSection = false;
                    }
                    // continue; // セクション区切り行自体は処理しない
                }

                if (inCommandsSection) {
                    const match = line.match(commandRegex);
                    if (match) {
                        const commandName = match[1];
                        // 'git-' プレフィックスは不要
                        const baseCommand = commandName.startsWith('git-') ? commandName.substring(4) : commandName;
                        // ツール名は 'git-' プレフィックス付きとする
                        const toolName = `git-${baseCommand}`;
                        const description = match[2].trim();

                        // 特定のコマンドを除外する場合 (例: GUIツール, ヘルパー)
                        const excludedCommands = ['citool', 'gitk', 'gui', 'instaweb', 'difftool', 'mergetool', 'credential', 'daemon', 'sh-i18n', 'sh-setup', 'archimport', 'cvsexportcommit', 'cvsimport', 'cvsserver', 'imap-send', 'p4', 'quiltimport', 'request-pull', 'svn', 'remote-'];
                        if (excludedCommands.some(ex => baseCommand.startsWith(ex))) {
                            continue;
                        }
                        // 重複チェック
                        if (!commands.some(c => c.name === toolName)) {
                            commands.push({ name: toolName, command: baseCommand, description });
                        }
                    }
                }
            }
            console.log(`Parsed ${commands.length} Git commands.`);
            if (commands.length === 0) {
                reject("No commands parsed, falling back to basic list.");
            } else {
                resolve(commands);
            }
        });

        gitHelp.on('error', (err) => {
            console.error('Failed to start git help -a:', err);
            // エラー時もフォールバック
            reject("Falling back to a predefined list of basic Git commands due to error.");
        });
    });
}

// コマンド実行結果の型
interface CommandResult {
    success: boolean;
    stdout?: string;
    stderr?: string;
    error?: string;
}

// Gitコマンドを実行する関数
async function executeGitCommand(command: string, argsString: string, cwd: string): Promise<CommandResult> {
    return new Promise((resolve) => {
        const fullCommand = `git ${command} ${argsString}`;
        console.log(`Executing command: "${fullCommand}" in directory: "${cwd}"`);

        exec(fullCommand, { cwd }, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error executing "${fullCommand}": ${error.message}`);
                resolve({
                    success: false,
                    error: error.message,
                    stderr: stderr,
                    stdout: stdout, // エラー時でも stdout がある場合がある
                });
                return;
            }
            // stderr があっても成功とみなす場合がある (git status など)
            if (stderr) {
                console.warn(`Stderr for "${fullCommand}": ${stderr}`);
            }
            console.log(`Stdout for "${fullCommand}": ${stdout}`);
            resolve({
                success: true,
                stdout: stdout,
                stderr: stderr,
            });
        });
    });
}


async function main() {
    console.log('Starting Git Commands MCP Server...');

    let gitCommandTools: Record<string, Tool> = {};
    let gitCommandsList: GitCommand[] = [];

    try {
        gitCommandsList = await getGitCommands();
        if (gitCommandsList.length === 0) {
            console.warn("Could not parse Git commands. Server starting with potentially limited or no Git tools.");
        } else {
             console.log(`Successfully obtained ${gitCommandsList.length} Git commands.`);
        }

        // Tool オブジェクトのマップを作成
        gitCommandTools = gitCommandsList.reduce((acc, cmd) => {
            acc[cmd.name] = {
                name: cmd.name,
                description: `Executes 'git ${cmd.command}': ${cmd.description}`,
                inputSchema: {
                    type: 'object',
                    properties: {
                        args: {
                            type: 'string',
                            description: `Arguments to pass to the 'git ${cmd.command}' command (e.g., '-m \"commit message\"' for commit). Escape quotes properly.`,
                            default: '',
                        },
                        cwd: {
                            type: 'string',
                            description: 'Working directory for command execution relative to the workspace root. Defaults to the workspace root.',
                            default: '.', // MCPクライアントのワークスペースルートを基準とする
                        }
                    },
                    required: [], // args は必須ではない
                } as Tool['inputSchema'], // Use Tool['inputSchema'] to get the type from Tool interface
            };
            return acc;
        }, {} as Record<string, Tool>);

        console.log(`Prepared ${Object.keys(gitCommandTools).length} tools.`);

    } catch (error) {
        console.error("Failed to initialize Git command tools:", error);
        // エラーが発生してもサーバーは起動を試みる (フォールバックリストがあれば)
        if (gitCommandsList.length === 0) {
             console.error("Server starting without any Git tools due to initialization error.");
        }
    }

    const serverInfo = { // Store server info
        name: 'git-commands-server', // サーバーの一意な名前
        version: '1.0.1', // バージョン
        displayName: 'Git Commands Server', // 表示名
        description: 'Provides tools for executing Git commands via MCP.', // 説明
        icon: 'git', // VS Code の Product Icon Theme で利用可能なアイコン名
        publisher: 'ukiuni', // 公開者情報 (オプション)
    };

    const mcpServer = new Server(
        serverInfo, // Use the stored info object
        {
            capabilities: {
                tools: {}, // tools capability を有効化
                // prompts: {}, // 必要であれば prompts も有効化
                // resources: {}, // 必要であれば resources も有効化
            },
        },
    );

    // ListTools リクエストハンドラ
    mcpServer.setRequestHandler(ListToolsRequestSchema, async (request: McpRequest): Promise<ListToolsResult> => { // Changed to ListToolsResult
        console.log(`Received ListTools request: ${JSON.stringify(request)}`);
        const tools = Object.values(gitCommandTools);
         console.log(`Responding with ${tools.length} tools.`);
        return {
            tools: tools,
        };
    });

    // CallTool リクエストハンドラ
    mcpServer.setRequestHandler(CallToolRequestSchema, async (request: McpRequest): Promise<CallToolResult> => { // Changed to CallToolResult
        console.log(`Received CallTool request: ${JSON.stringify(request)}`);
        // Ensure params exist before destructuring
        const name = request.params?.name as string;
        const args = request.params?.arguments as Record<string, unknown> | undefined;

        if (!name) {
             console.error('CallTool request missing tool name.');
             throw new Error('Tool name is required.');
        }

        const tool = gitCommandTools[name];
        const commandInfo = gitCommandsList.find(cmd => cmd.name === name);

        if (!tool || !commandInfo) {
            console.error(`Tool not found: ${name}`);
            throw new Error(`Tool not found: ${name}`);
        }

        const argsString = args?.args as string || '';
        const relativeCwd = args?.cwd as string || '.';
        const executionCwd = require('path').resolve(process.cwd(), relativeCwd);


        try {
            const result = await executeGitCommand(commandInfo.command, argsString, executionCwd);

            // 結果をMCPレスポンス形式に変換
            // Explicitly type the array elements to match CallToolResult['content']
            const responseContent: { type: 'text'; text: string }[] = [];
            if (result.stdout) {
                responseContent.push({ type: 'text', text: `STDOUT:\n${result.stdout}` });
            }
            if (result.stderr) {
                // stderr は警告や情報を含むこともあるため、エラーとは限らない
                 responseContent.push({ type: 'text', text: `STDERR:\n${result.stderr}` });
            }
             if (result.error) {
                 responseContent.push({ type: 'text', text: `ERROR:\n${result.error}` });
             }
             if (responseContent.length === 0 && result.success) {
                 responseContent.push({ type: 'text', text: 'Command executed successfully with no output.' });
             } else if (responseContent.length === 0 && !result.success) {
                 responseContent.push({ type: 'text', text: 'Command failed with no output.' });
             }


            console.log(`Responding to CallTool request for ${name}`);
            return {
                // content: [{ type: 'text', text: JSON.stringify(result) }], // 単純なテキストとして返す場合
                 content: responseContent, // より詳細なテキストとして返す場合
            };
        } catch (error: any) {
            console.error(`Error executing tool ${name}:`, error);
            // エラーをMCPレスポンスとして返す
            return {
                // Explicitly type the error content as well
                content: [{ type: 'text', text: `Error executing tool ${name}: ${error.message}` }],
            };
        }
    });

    // サーバーの起動
    const transport = new StdioServerTransport();
    try {
        await mcpServer.connect(transport);
        // Access server info from the stored object
        console.log(`MCP server "${serverInfo.displayName}" (Name: ${serverInfo.name}) is running via stdio.`);
        console.log(`Provide the following name to your MCP client: ${serverInfo.name}`);
    } catch (error) {
        console.error('Failed to connect MCP server:', error);
        process.exit(1);
    }
}

main().catch(error => {
    console.error("Unhandled error during server execution:", error);
    process.exit(1);
});