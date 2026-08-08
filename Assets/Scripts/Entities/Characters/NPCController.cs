using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using RunToExit.Commands;

namespace RunToExit.Core
{
    public class NPCController : CharacterBase
    {
        private Queue<ICommand> commandQueue = new Queue<ICommand>();
        private Coroutine currentCommandCoroutine;

        public void AddCommand(ICommand command)
        {
            commandQueue.Enqueue(command);
            if (currentCommandCoroutine == null && State == CharacterState.Idle)
            {
                ProcessNextCommand();
            }
        }

        public void ClearCommands()
        {
            commandQueue.Clear();
            if (currentCommandCoroutine != null)
            {
                StopCoroutine(currentCommandCoroutine);
                currentCommandCoroutine = null;
            }
            State = CharacterState.Idle; // キャンセルされたら待機状態に
        }

        private void ProcessNextCommand()
        {
            if (commandQueue.Count > 0)
            {
                ICommand cmd = commandQueue.Dequeue();
                currentCommandCoroutine = StartCoroutine(ExecuteCommandRoutine(cmd));
            }
            else
            {
                currentCommandCoroutine = null;
            }
        }

        private IEnumerator ExecuteCommandRoutine(ICommand command)
        {
            yield return StartCoroutine(command.ExecuteCoroutine(this));
            ProcessNextCommand(); // 次のコマンドへ
        }

        public override void CheckFall()
        {
            base.CheckFall();
            // 落下後にコマンドが途切れていたら再開を試みるか、中止するか
            if (State == CharacterState.Idle && currentCommandCoroutine == null)
            {
                ProcessNextCommand();
            }
        }
    }
}
