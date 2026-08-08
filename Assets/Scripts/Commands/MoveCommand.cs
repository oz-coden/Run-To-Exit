using System.Collections;
using System.Collections.Generic;
using UnityEngine;

namespace RunToExit.Core
{
    public class MoveCommand : ICommand
    {
        private Vector2Int targetPos;

        public MoveCommand(Vector2Int target)
        {
            targetPos = target;
        }

        public IEnumerator ExecuteCoroutine(CharacterBase character)
        {
            // パスファインディングを使用して経路を取得
            List<Vector2Int> path = Pathfinder.FindPath(character, character.GridPosition, targetPos);
            if (path == null || path.Count == 0)
            {
                Debug.Log($"{character.gameObject.name} cannot find a path to {targetPos}");
                yield break;
            }

            foreach (var step in path)
            {
                if (character.State != CharacterState.Idle)
                {
                    while (character.State != CharacterState.Idle) yield return null;
                }

                // 進行方向を計算
                int dirX = step.x > character.GridPosition.x ? 1 : (step.x < character.GridPosition.x ? -1 : 0);

                if (step.y > character.GridPosition.y)
                {
                    if (step.x != character.GridPosition.x)
                    {
                        if (!character.TryStepUp(step)) yield break;
                    }
                    else
                    {
                        // よじ登りロジックは幅跳びや特殊操作に依存
                        yield break; 
                    }
                }
                else if (Mathf.Abs(step.x - character.GridPosition.x) > 1 && step.y == character.GridPosition.y)
                {
                    if (!character.TryLongJump(dirX)) yield break;
                }
                else
                {
                    if (!character.TryMove(dirX)) yield break;
                }

                // 次の移動まで待機
                while (character.State != CharacterState.Idle) yield return null;
            }
        }
    }
}
