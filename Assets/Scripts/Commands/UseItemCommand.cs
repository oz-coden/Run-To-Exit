using System.Collections;
using UnityEngine;

namespace RunToExit.Core
{
    public class UseItemCommand : ICommand
    {
        private InteractableBase targetInteractable;

        public UseItemCommand(InteractableBase target)
        {
            targetInteractable = target;
        }

        public IEnumerator ExecuteCoroutine(CharacterBase character)
        {
            // インタラクト対象の隣接マスまで移動する
            Vector2Int targetPos = targetInteractable.GridPosition;
            Vector2Int adjacentPos = targetPos + new Vector2Int(targetPos.x > character.GridPosition.x ? -1 : 1, 0);

            // ターゲットが1マス隣にいない場合のみ移動する
            if (Mathf.Abs(character.GridPosition.x - targetPos.x) > 1 || character.GridPosition.y != targetPos.y)
            {
                ICommand moveCmd = new MoveCommand(adjacentPos);
                yield return character.StartCoroutine(moveCmd.ExecuteCoroutine(character));
            }

            // 移動が完了したら対象の方向を向く
            int dirX = targetPos.x > character.GridPosition.x ? 1 : -1;
            character.FacingDirection = dirX;

            // インタラクト処理
            if (targetInteractable is ItemBase item)
            {
                character.PickUpItem(item);
            }
            else
            {
                character.UseItemOn(targetInteractable);
            }

            yield return null;
        }
    }
}
