using UnityEngine;

namespace RunToExit.Core
{
    public enum StairDirection
    {
        RightUp,  // / (右上がり)
        LeftUp    // \ (左上がり)
    }

    public class Stairs : MonoBehaviour, IGridEntity
    {
        public Vector2Int GridPosition { get; private set; }
        public StairDirection Direction = StairDirection.RightUp;

        public void InitializePosition()
        {
            GridPosition = new Vector2Int(Mathf.RoundToInt(transform.position.x), Mathf.RoundToInt(transform.position.y));
        }

        public bool IsSolidTo(CharacterBase character)
        {
            // 階段自体は壁ではない
            return false;
        }

        public bool IsInteractable { get; } = false;

        public void OnInteract(CharacterBase character)
        {
        }

        private void Start()
        {
            InitializePosition();
            GridManager.Instance.AddEntity(this);
        }

        private void OnDestroy()
        {
            if (GridManager.Instance != null)
            {
                GridManager.Instance.RemoveEntity(this);
            }
        }
    }
}
