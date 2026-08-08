using UnityEngine;

namespace RunToExit.Core
{
    public interface IGridEntity
    {
        Vector2Int GridPosition { get; }
        
        // このエンティティが対象キャラクターにとって通行不可能な障害物かどうか
        bool IsSolidTo(CharacterBase character);
        
        // 拾う、使うなどのアクションが可能か
        bool IsInteractable { get; }

        // インタラクトされた時の処理
        void OnInteract(CharacterBase character);
    }
}
