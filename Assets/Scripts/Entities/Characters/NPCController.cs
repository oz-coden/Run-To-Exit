using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace RunToExit.Core
{
    public class NPCController : CharacterBase
    {
        private Queue<ICommand> commandQueue = new Queue<ICommand>();
        private Coroutine currentCommandCoroutine;

        public bool IsRescued { get; private set; } = false;
        public bool IsEscaped { get; private set; } = false;

        public void Rescue()
        {
            IsRescued = true;
            if (CommandManager.Instance != null)
            {
                CommandManager.Instance.SelectNPC(this);
            }
            Debug.Log($"{gameObject.name} was rescued!");
        }

        public void Escape()
        {
            if (IsEscaped) return;
            IsEscaped = true;
            ClearCommands();
            if (GridManager.Instance != null)
            {
                GridManager.Instance.RemoveEntity(this);
            }
            Debug.Log($"{gameObject.name} escaped successfully!");
            gameObject.SetActive(false);
        }

        public void AddCommand(ICommand command)
        {
            if (IsEscaped) return;
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
            if (IsEscaped) return;

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
            try
            {
                yield return StartCoroutine(command.ExecuteCoroutine(this));
            }
            finally
            {
                if (State != CharacterState.Falling)
                {
                    State = CharacterState.Idle;
                }
                currentCommandCoroutine = null;
                ProcessNextCommand(); // 次のコマンドへ
            }
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
